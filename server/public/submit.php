<?php
declare(strict_types=1);

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
header('Vary: Origin');
if (empty($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off') {
    http_response_code(426);
    echo '{"ok":false,"code":"https","message":"Откройте сайт по защищённому адресу HTTPS."}';
    exit;
}

$private = dirname(__DIR__) . '/private';
if (!is_file($private . '/config.php')) {
    http_response_code(503);
    echo json_encode(['ok' => false, 'code' => 'unavailable', 'message' => 'Форма временно недоступна.'], JSON_UNESCAPED_UNICODE);
    exit;
}
$config = require $private . '/config.php';
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $config['origins'], true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Max-Age: 600');
}
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 16384) {
    http_response_code(413);
    echo '{"ok":false,"code":"size","message":"Слишком длинное обращение."}';
    exit;
}
require $private . '/enquiry.php';
$service = new HjcEnquiry($config, $private . '/state',
    static fn($to, $subject, $body, $headers, $sender): bool => mail($to, $subject, $body, $headers, '-f' . $sender));
$result = $service->handle([
    'method' => $_SERVER['REQUEST_METHOD'] ?? '',
    'origin' => $origin,
    'content_type' => $_SERVER['CONTENT_TYPE'] ?? '',
    'body' => (string) file_get_contents('php://input', false, null, 0, 16385),
    'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
]);
http_response_code($result['status']);
foreach ($result['headers'] as $name => $value) header($name . ': ' . $value);
if ($result['status'] !== 204) echo json_encode($result['body'], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
