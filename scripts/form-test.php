<?php
declare(strict_types=1);
require __DIR__ . '/../server/private/enquiry.php';
$directory = sys_get_temp_dir() . '/hjcpit-form-test-' . bin2hex(random_bytes(8));
$config = require __DIR__ . '/../server/private/config.example.php';
$config['enabled'] = true;
$now = 1800000000;
$deliveries = [];
$mailWorks = true;
$service = new HjcEnquiry($config, $directory, static function (...$args) use (&$deliveries, &$mailWorks) {
    $deliveries[] = $args;
    return $mailWorks;
}, static function () use (&$now) { return $now; });
function expect($actual, $expected, string $label): void {
    if ($actual !== $expected) throw new RuntimeException($label . ': ' . json_encode($actual));
}
function callForm(array $changes = [], ?array $data = null): array {
    global $service;
    return $service->handle($changes + [
        'method' => $data === null ? 'GET' : 'POST', 'origin' => 'https://hjcpit.com',
        'ip' => '192.0.2.15', 'content_type' => 'application/json',
        'body' => $data === null ? '' : json_encode($data, JSON_THROW_ON_ERROR),
    ]);
}
try {
    expect(callForm(['origin' => 'https://evil.example'])['status'], 403, 'Foreign origin');
    expect(callForm(['origin' => 'https://tema-git.github.io'])['status'], 403, 'Preview cannot send');
    expect(callForm(['method' => 'OPTIONS'])['status'], 204, 'Preflight');
    expect(callForm(['method' => 'PUT'])['status'], 405, 'Unsupported method');
    $token = callForm()['body']['token'];
    $data = ['name' => 'Тест формы', 'contact' => 'qa@example.invalid', 'message' => "Только тест\nВторая строка", 'website' => '',
        'consent' => true, 'consentVersion' => '2026-11-12', 'page' => 'catalog', 'token' => $token, 'requestId' => str_repeat('a', 32)];
    foreach ([['consent' => false], ['consentVersion' => 'old'], ['name' => 'Я'], ['contact' => "test@example.com\r\nBcc: other@example.com"], ['message' => str_repeat('я', 2001)]] as $bad) {
        expect(callForm([], $bad + $data)['status'], 422, 'Validation/consent');
    }
    expect(callForm([], ['website' => 'spam'] + $data)['status'], 422, 'Honeypot');
    expect(callForm(['ip' => '192.0.2.16'], $data)['status'], 403, 'Token bound to IP');
    expect(callForm(['origin' => 'https://www.hjcpit.com'], $data)['status'], 403, 'Token bound to origin');
    expect(callForm(['content_type' => 'text/plain'], $data)['status'], 415, 'Content type');
    expect(callForm(['body' => str_repeat('a', 16385)], $data)['status'], 413, 'Body size');
    expect(callForm(['body' => '{invalid'], $data)['status'], 400, 'Invalid JSON');
    expect(count($deliveries), 0, 'Rejected requests do not send');
    expect(callForm([], $data)['status'], 200, 'Accepted send');
    expect(callForm([], $data)['status'], 200, 'Retry returns existing receipt');
    expect(count($deliveries), 1, 'No duplicate mail');
    expect(callForm([], ['message' => 'Changed'] + $data)['status'], 409, 'Request id cannot change payload');
    expect($deliveries[0][0], 'hunterjchinaski.work@gmail.com', 'Fixed recipient');
    expect($deliveries[0][3]['Reply-To'], 'qa@example.invalid', 'Reply address');
    expect(str_contains(base64_decode($deliveries[0][2]), 'Согласие на обработку данных: да'), true, 'Consent receipt');
    foreach (glob($directory . '/*.json') as $file) {
        $content = file_get_contents($file);
        expect(str_contains($content, 'qa@example.invalid'), false, 'No raw contact stored');
        expect(str_contains($content, '192.0.2.15'), false, 'No raw IP stored');
    }
    for ($i = 1; $i < 5; $i++) expect(callForm([], ['requestId' => str_pad(dechex($i), 32, '0', STR_PAD_LEFT)] + $data)['status'], 200, 'Within limit');
    expect(callForm([], ['requestId' => str_repeat('b', 32)] + $data)['status'], 429, 'Send rate limit');
    $now += 901;
    $mailWorks = false;
    $retry = ['requestId' => str_repeat('c', 32)] + $data;
    expect(callForm([], $retry)['status'], 503, 'Mail rejection is not success');
    $mailWorks = true;
    expect(callForm([], $retry)['status'], 200, 'Definite failure can retry');
    $before = count($deliveries);
    $state = json_decode(file_get_contents($directory . '/state.json'), true);
    $state['requests'][$retry['requestId']]['status'] = 'pending';
    file_put_contents($directory . '/state.json', json_encode($state));
    expect(callForm([], $retry)['body']['code'], 'uncertain', 'Crash after handoff does not resend');
    expect(count($deliveries), $before, 'No duplicate after uncertain handoff');
    $now += 7201;
    expect(callForm([], ['requestId' => str_repeat('d', 32)] + $data)['status'], 403, 'Expired token');
    echo "Form server checks passed: validation, consent, CORS, token, mail failure, deduplication, crash safety, rate limit, private state.\n";
} finally {
    foreach (glob($directory . '/*') ?: [] as $file) unlink($file);
    if (is_dir($directory)) rmdir($directory);
}
