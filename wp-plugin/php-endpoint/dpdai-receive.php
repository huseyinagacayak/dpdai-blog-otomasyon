<?php
/**
 * DPDAI Receive - WordPress olmayan ozel PHP siteler icin alici uc.
 *
 * KURULUM
 *  1. Bu dosyayi sitenizin kok dizinine (veya erisilebilir bir klasore) kopyalayin.
 *  2. Asagidaki DPDAI_TOKEN sabitini uzun ve rastgele bir degerle degistirin,
 *     ayni degeri panelde "Bridge Token" alanina yazin.
 *  3. DPDAI_DB_* ve tablo/kolon adlarini kendi veritabaniniza gore duzenleyin.
 *  4. Panelde site platformunu "Özel PHP site", endpoint adresini de bu dosyanin
 *     tam URL'si olarak girin.
 *
 * GUVENLIK
 *  - Mutlaka HTTPS uzerinden kullanin; token duz metin gider.
 *  - Token'i kaynak kodda tutmak istemiyorsaniz getenv('DPDAI_TOKEN') kullanin.
 */

declare(strict_types=1);

// ---------------------------------------------------------------- ayarlar

const DPDAI_TOKEN = 'BURAYA_UZUN_RASTGELE_BIR_TOKEN_YAZIN';

const DPDAI_DB_HOST = 'localhost';
const DPDAI_DB_NAME = 'veritabani_adi';
const DPDAI_DB_USER = 'kullanici';
const DPDAI_DB_PASS = 'sifre';

/** Yazilarin tutuldugu tablo ve kolon eslemesi */
const DPDAI_TABLE = 'blog_yazilari';
const DPDAI_COLS = [
    'external_id'      => 'external_id',
    'title'            => 'baslik',
    'slug'             => 'slug',
    'content'          => 'icerik',
    'excerpt'          => 'ozet',
    'status'           => 'durum',
    'locale'           => 'dil',
    'category'         => 'kategori',
    'tags'             => 'etiketler',
    'meta_title'       => 'seo_baslik',
    'meta_description' => 'seo_aciklama',
    'focus_keyword'    => 'odak_kelime',
    'schema_json'      => 'schema_json',
    'image_url'        => 'gorsel',
    'image_alt'        => 'gorsel_alt',
    'published_at'     => 'yayin_tarihi',
];

/** Yuklenen gorsellerin kaydedilecegi klasor (yazilabilir olmali) */
const DPDAI_UPLOAD_DIR = __DIR__ . '/uploads/blog';
const DPDAI_UPLOAD_URL = '/uploads/blog';

/** Sitenizin genel adresi (gorsel URL'leri icin) */
const DPDAI_SITE_URL = 'https://ornek.com';

// ---------------------------------------------------------------- yardimci

header('Content-Type: application/json; charset=utf-8');

function dpdai_fail(int $code, string $message): never
{
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_UNICODE);
    exit;
}

function dpdai_ok(array $data): never
{
    echo json_encode($data + ['ok' => true], JSON_UNESCAPED_UNICODE);
    exit;
}

function dpdai_db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', DPDAI_DB_HOST, DPDAI_DB_NAME);
        $pdo = new PDO($dsn, DPDAI_DB_USER, DPDAI_DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

// ---------------------------------------------------------------- yetki

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    dpdai_fail(405, 'Yalnizca POST kabul edilir.');
}

$sent = $_SERVER['HTTP_X_DPDAI_TOKEN'] ?? '';
if (DPDAI_TOKEN === 'BURAYA_UZUN_RASTGELE_BIR_TOKEN_YAZIN') {
    dpdai_fail(500, 'Token ayarlanmamis. dpdai-receive.php icindeki DPDAI_TOKEN degerini degistirin.');
}
if ($sent === '' || !hash_equals(DPDAI_TOKEN, $sent)) {
    dpdai_fail(401, 'Gecersiz token.');
}

$raw  = file_get_contents('php://input') ?: '';
$body = json_decode($raw, true);
if (!is_array($body)) {
    dpdai_fail(400, 'Gecersiz JSON govdesi.');
}

$action  = (string) ($body['action'] ?? '');
$payload = is_array($body['payload'] ?? null) ? $body['payload'] : [];

// ---------------------------------------------------------------- islemler

try {
    switch ($action) {
        // ---------------------------------------------------------- info
        case 'info':
            $cats = [];
            // Kendi kategori tablonuz varsa burayi doldurun:
            // $cats = dpdai_db()->query('SELECT id, ad AS name, slug FROM kategoriler')->fetchAll();
            dpdai_ok([
                'version'    => '1.0.0',
                'site_url'   => DPDAI_SITE_URL,
                'languages'  => ['tr'],
                'categories' => $cats,
            ]);

        // ---------------------------------------------------------- medya
        case 'upload_media':
            $filename = basename((string) ($payload['filename'] ?? 'gorsel.webp'));
            $filename = preg_replace('/[^A-Za-z0-9._-]/', '-', $filename) ?? 'gorsel.webp';
            $data     = base64_decode((string) ($payload['data_base64'] ?? ''), true);

            if ($data === false || $data === '') {
                dpdai_fail(400, 'Gorsel verisi bos veya bozuk.');
            }
            if (strlen($data) > 10 * 1024 * 1024) {
                dpdai_fail(413, 'Gorsel 10 MB sinirini asiyor.');
            }
            if (!is_dir(DPDAI_UPLOAD_DIR) && !mkdir(DPDAI_UPLOAD_DIR, 0755, true)) {
                dpdai_fail(500, 'Yukleme klasoru olusturulamadi.');
            }

            $target = DPDAI_UPLOAD_DIR . '/' . $filename;
            if (file_put_contents($target, $data) === false) {
                dpdai_fail(500, 'Gorsel diske yazilamadi.');
            }

            dpdai_ok([
                'id'  => crc32($filename),
                'url' => DPDAI_SITE_URL . DPDAI_UPLOAD_URL . '/' . $filename,
            ]);

        // ---------------------------------------------------------- yayin
        case 'publish':
            $c           = DPDAI_COLS;
            $externalId  = (string) ($payload['external_id'] ?? '');
            if ($externalId === '') {
                dpdai_fail(400, 'external_id zorunlu.');
            }

            $seo = is_array($payload['seo'] ?? null) ? $payload['seo'] : [];

            $values = [
                $c['external_id']      => $externalId,
                $c['title']            => (string) ($payload['title'] ?? ''),
                $c['slug']             => (string) ($payload['slug'] ?? ''),
                $c['content']          => (string) ($payload['content'] ?? ''),
                $c['excerpt']          => (string) ($payload['excerpt'] ?? ''),
                $c['status']           => (string) ($payload['status'] ?? 'draft'),
                $c['locale']           => (string) ($payload['locale'] ?? 'tr'),
                $c['category']         => implode(',', (array) ($payload['categories'] ?? [])),
                $c['tags']             => implode(',', (array) ($payload['tags'] ?? [])),
                $c['meta_title']       => (string) ($seo['metaTitle'] ?? ''),
                $c['meta_description'] => (string) ($seo['metaDescription'] ?? ''),
                $c['focus_keyword']    => (string) ($seo['focusKeyword'] ?? ''),
                $c['schema_json']      => isset($seo['schema'])
                    ? json_encode($seo['schema'], JSON_UNESCAPED_UNICODE)
                    : '',
                $c['image_url']        => (string) ($payload['featured_image_url'] ?? ''),
                $c['image_alt']        => (string) ($seo['imageAlt'] ?? ''),
                $c['published_at']     => (string) ($payload['date'] ?? date('Y-m-d H:i:s')),
            ];

            $db = dpdai_db();

            // Idempotency: ayni external_id varsa guncelle
            $stmt = $db->prepare(
                sprintf('SELECT id FROM `%s` WHERE `%s` = ? LIMIT 1', DPDAI_TABLE, $c['external_id'])
            );
            $stmt->execute([$externalId]);
            $existing = $stmt->fetchColumn();

            if ($existing) {
                $sets = [];
                foreach (array_keys($values) as $col) {
                    if ($col === $c['external_id']) {
                        continue;
                    }
                    $sets[] = sprintf('`%s` = ?', $col);
                }
                $params = $values;
                unset($params[$c['external_id']]);
                $params[] = $existing;

                $db->prepare(
                    sprintf('UPDATE `%s` SET %s WHERE id = ?', DPDAI_TABLE, implode(', ', $sets))
                )->execute(array_values($params));

                $id = (int) $existing;
            } else {
                $cols         = array_keys($values);
                $placeholders = implode(', ', array_fill(0, count($cols), '?'));
                $db->prepare(sprintf(
                    'INSERT INTO `%s` (%s) VALUES (%s)',
                    DPDAI_TABLE,
                    '`' . implode('`, `', $cols) . '`',
                    $placeholders
                ))->execute(array_values($values));

                $id = (int) $db->lastInsertId();
            }

            dpdai_ok([
                'id'     => $id,
                'url'    => rtrim(DPDAI_SITE_URL, '/') . '/blog/' . $values[$c['slug']],
                'status' => $values[$c['status']],
            ]);

        default:
            dpdai_fail(400, 'Bilinmeyen islem: ' . $action);
    }
} catch (Throwable $e) {
    dpdai_fail(500, 'Sunucu hatasi: ' . $e->getMessage());
}
