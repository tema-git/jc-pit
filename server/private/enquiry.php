<?php
declare(strict_types=1);

// No visitor fields are written to disk. Only HMACs, counters and receipts are
// retained here. The directory and configuration must stay outside public_html.
final class HjcEnquiry
{
    private array $config;
    private string $directory;
    private $deliver;
    private $clock;

    public function __construct(array $config, string $directory, callable $deliver, ?callable $clock = null)
    {
        $this->config = $config;
        $this->directory = $directory;
        $this->deliver = $deliver;
        $this->clock = $clock ?? static fn(): int => time();
    }

    private function result(int $status, array $body, array $headers = []): array
    {
        return ['status' => $status, 'body' => $body, 'headers' => $headers];
    }

    private function error(int $status, string $code, string $message, array $extra = []): array
    {
        return $this->result($status, ['ok' => false, 'code' => $code, 'message' => $message] + $extra);
    }

    private function save(string $name, array $data): void
    {
        $temporary = $this->directory . '/.' . bin2hex(random_bytes(12));
        $encoded = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        if (file_put_contents($temporary, $encoded, LOCK_EX) !== strlen($encoded)
            || !chmod($temporary, 0600) || !rename($temporary, $this->directory . '/' . $name)) {
            @unlink($temporary);
            throw new RuntimeException('Cannot commit form state');
        }
    }

    private function read(string $name, array $default): array
    {
        $file = $this->directory . '/' . $name;
        if (!file_exists($file)) return $default;
        if (is_link($file)) throw new RuntimeException('Invalid state file');
        $data = json_decode((string) file_get_contents($file), true, 64, JSON_THROW_ON_ERROR);
        if (!is_array($data)) throw new RuntimeException('Invalid state');
        return $data;
    }

    private static function length(string $value): int
    {
        return preg_match_all('/./us', $value);
    }

    private function fields(array $data): array
    {
        $errors = [];
        foreach (['name', 'contact', 'message', 'website'] as $field) {
            if (!isset($data[$field]) || !is_string($data[$field]) || !preg_match('//u', $data[$field])) {
                $errors[$field] = 'Проверьте заполнение поля.';
            }
        }
        if ($errors) return $errors;
        $name = trim($data['name']);
        $contact = trim($data['contact']);
        if (self::length($name) < 2 || self::length($name) > 80 || preg_match('/[\x00-\x1F\x7F]/u', $name)) {
            $errors['name'] = 'Укажите имя длиной от 2 до 80 символов.';
        }
        $email = filter_var($contact, FILTER_VALIDATE_EMAIL) !== false;
        $telegram = preg_match('/^@[A-Za-z0-9_]{4,32}$/D', $contact) === 1;
        $phone = preg_match('/^\+?[0-9 ().-]+$/D', $contact) === 1
            && strlen(preg_replace('/\D/', '', $contact)) >= 7
            && strlen(preg_replace('/\D/', '', $contact)) <= 15;
        if (self::length($contact) > 160 || preg_match('/[\x00-\x1F\x7F]/u', $contact)
            || !($email || $telegram || $phone)) {
            $errors['contact'] = 'Укажите email, телефон или @ник в Telegram.';
        }
        if (self::length($data['message']) > 2000 || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $data['message'])) {
            $errors['message'] = 'Сократите пожелания до 2000 символов.';
        }
        if (($data['consent'] ?? false) !== true || ($data['consentVersion'] ?? '') !== $this->config['consent_version']) {
            $errors['consent'] = 'Для отправки нужно согласие на обработку данных.';
        }
        return $errors;
    }

    public function handle(array $request): array
    {
        $method = $request['method'];
        $origin = $request['origin'];
        if (!in_array($origin, $this->config['origins'], true)) {
            return $this->error(403, 'origin', 'Отправьте обращение через форму на hjcpit.com.');
        }
        if ($method === 'OPTIONS') {
            return $this->result(204, []);
        }
        if (!in_array($method, ['GET', 'POST'], true)) return $this->error(405, 'method', 'Метод не поддерживается.');
        if (empty($this->config['enabled'])) return $this->error(503, 'unavailable', 'Форма временно недоступна. Напишите нам на почту.');
        if ($method === 'POST' && strtolower(trim(explode(';', $request['content_type'])[0])) !== 'application/json') {
            return $this->error(415, 'type', 'Не удалось прочитать обращение. Обновите страницу.');
        }
        if (strlen($request['body']) > 16384) return $this->error(413, 'size', 'Слишком длинное обращение.');
        $data = [];
        if ($method === 'POST') {
            try { $data = json_decode($request['body'], true, 16, JSON_THROW_ON_ERROR); }
            catch (JsonException $error) { return $this->error(400, 'json', 'Не удалось прочитать обращение.'); }
            if (!is_array($data)) return $this->error(400, 'json', 'Не удалось прочитать обращение.');
            if ($errors = $this->fields($data)) return $this->error(422, 'validation', 'Проверьте поля формы.', ['fields' => $errors]);
            if (trim($data['website']) !== '') return $this->error(422, 'rejected', 'Не удалось отправить обращение. Напишите нам на почту.');
            if (!isset($data['requestId']) || !is_string($data['requestId']) || !preg_match('/^[a-f0-9]{32}$/D', $data['requestId'])) {
                return $this->error(400, 'request', 'Обновите страницу и попробуйте снова.');
            }
            if (!in_array($data['page'] ?? '', ['catalog', 'archive'], true)) return $this->error(400, 'page', 'Обновите страницу и попробуйте снова.');
        }
        $lock = null;
        try {
            if (!is_dir($this->directory) && !mkdir($this->directory, 0700, true) && !is_dir($this->directory)) throw new RuntimeException('Cannot create state');
            if (is_link($this->directory) || is_link($this->directory . '/lock')) throw new RuntimeException('Invalid state directory');
            $lock = fopen($this->directory . '/lock', 'c');
            if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Cannot lock state');
            chmod($this->directory . '/lock', 0600);
            $keys = $this->read('key.json', []);
            if (!$keys) {
                $keys = ['key' => bin2hex(random_bytes(32))];
                $this->save('key.json', $keys);
            }
            $secret = $keys['key'];
            $now = ($this->clock)();
            // Trust the direct connection, never a caller-supplied forwarding header.
            $ip = hash_hmac('sha256', $request['ip'], $secret);
            $state = $this->read('state.json', ['requests' => [], 'limits' => []]);
            $state['requests'] = array_filter($state['requests'], static fn($row) => $row['time'] > $now - 604800);
            foreach ($state['limits'] as $key => &$times) {
                $times = array_values(array_filter($times, static fn($time) => $time > $now - 86400));
                if (!$times) unset($state['limits'][$key]);
            }
            unset($times);
            if ($method === 'GET') {
                $times = $state['limits']['token:' . $ip] ?? [];
                if (count(array_filter($times, static fn($t) => $t > $now - 3600)) >= 60) {
                    return $this->error(429, 'rate', 'Слишком много запросов. Попробуйте позже.');
                }
                if (count($state['limits']) > 6000) return $this->error(503, 'busy', 'Попробуйте отправить обращение позже.');
                $state['limits']['token:' . $ip][] = $now;
                $this->save('state.json', $state);
                $payload = $now . '.' . bin2hex(random_bytes(16));
                $token = $payload . '.' . hash_hmac('sha256', $payload . '|' . $origin . '|' . $ip, $secret);
                return $this->result(200, ['ok' => true, 'token' => $token, 'expiresIn' => 7200]);
            }
            $token = $data['token'] ?? '';
            $parts = is_string($token) ? explode('.', $token) : [];
            if (count($parts) !== 3 || !ctype_digit($parts[0]) || !preg_match('/^[a-f0-9]{32}$/D', $parts[1])
                || (int) $parts[0] > $now || (int) $parts[0] < $now - 7200
                || !hash_equals(hash_hmac('sha256', $parts[0] . '.' . $parts[1] . '|' . $origin . '|' . $ip, $secret), $parts[2])) {
                return $this->error(403, 'token', 'Проверка формы устарела. Повторите отправку.');
            }
            $id = $data['requestId'];
            $fingerprint = hash_hmac('sha256', json_encode([$data['name'], $data['contact'], $data['message'], $data['page'], $data['consentVersion']], JSON_THROW_ON_ERROR), $secret);
            $existing = $state['requests'][$id] ?? null;
            if ($existing) {
                if (!hash_equals($existing['fingerprint'], $fingerprint)) return $this->error(409, 'changed', 'Данные изменились. Обновите страницу перед новой отправкой.');
                if ($existing['status'] === 'accepted') return $this->result(200, ['ok' => true, 'reference' => strtoupper(substr($id, 0, 8))]);
                if ($existing['status'] === 'pending') return $this->error(503, 'uncertain', 'Обращение обрабатывается. Напишите нам на почту, если ответ не придёт.');
            }
            $personal = $state['limits']['send:' . $ip] ?? [];
            $global = $state['limits']['send:all'] ?? [];
            if (count(array_filter($personal, static fn($t) => $t > $now - 900)) >= 5 || count($personal) >= 20
                || count(array_filter($global, static fn($t) => $t > $now - 3600)) >= 40 || count($global) >= 200) {
                return $this->error(429, 'rate', 'Слишком много обращений. Попробуйте позже или напишите нам на почту.');
            }
            $state['limits']['send:' . $ip][] = $now;
            $state['limits']['send:all'][] = $now;
            $state['requests'][$id] = ['fingerprint' => $fingerprint, 'time' => $now, 'status' => 'pending'];
            $this->save('state.json', $state);
            // Persist pending BEFORE handing the message to the mail transport.
            // A crash after handoff must never cause an automatic duplicate.
            $reference = strtoupper(substr($id, 0, 8));
            $subject = '=?UTF-8?B?' . base64_encode('JC Pit — обращение ' . $reference) . '?=';
            $body = "Новое обращение с hjcpit.com\n\n"
                . "Имя: " . trim($data['name']) . "\nКонтакт: " . trim($data['contact'])
                . "\n\nПожелания:\n" . (trim($data['message']) ?: 'Не указаны')
                . "\n\nСтраница: https://hjcpit.com/" . $data['page'] . '.html'
                . "\nНомер: " . $reference . "\nДата (UTC): " . gmdate('Y-m-d H:i:s', $now)
                . "\nСогласие на обработку данных: да; редакция " . $this->config['consent_version']
                . "\nhttps://hjcpit.com/consent.html\n";
            $headers = [
                'From' => 'JC Pit <' . $this->config['sender'] . '>',
                'MIME-Version' => '1.0',
                'Content-Type' => 'text/plain; charset=UTF-8',
                'Content-Transfer-Encoding' => 'base64',
                'Message-ID' => '<hjcpit-' . $id . '@hjcpit.com>',
                'Date' => gmdate('D, d M Y H:i:s O', $now),
            ];
            if (filter_var(trim($data['contact']), FILTER_VALIDATE_EMAIL)) $headers['Reply-To'] = trim($data['contact']);
            $sent = ($this->deliver)($this->config['recipient'], $subject, chunk_split(base64_encode($body)), $headers, $this->config['sender']);
            $state['requests'][$id]['status'] = $sent ? 'accepted' : 'failed';
            $this->save('state.json', $state);
            return $sent
                ? $this->result(200, ['ok' => true, 'reference' => $reference])
                : $this->error(503, 'delivery', 'Не удалось отправить обращение. Попробуйте позже или напишите нам на почту.');
        } catch (Throwable $error) {
            // No request bodies or visitor details in application logs or errors.
            error_log('JC Pit form: server operation failed');
            return $this->error(503, 'unavailable', 'Не удалось подтвердить отправку. Повторите попытку или напишите нам на почту.');
        } finally {
            if (is_resource($lock)) { flock($lock, LOCK_UN); fclose($lock); }
        }
    }
}
