<?php
/**
 * Plugin Name: DPDAI Bridge
 * Description: Blog otomasyon paneli ile WordPress arasinda kopru. SEO metalari, Polylang/WPML dil baglantisi ve tekrarsiz (idempotent) yazi yayini saglar.
 * Version:     1.6.0
 * Author:      DPDAI
 * License:     GPL-2.0-or-later
 * Text Domain: dpdai-bridge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'DPDAI_BRIDGE_VERSION', '1.6.0' );
define( 'DPDAI_TOKEN_OPTION', 'dpdai_bridge_token' );
define( 'DPDAI_EXTERNAL_ID_META', '_dpdai_external_id' );

define( 'DPDAI_PLUGIN_FILE', __FILE__ );

require_once __DIR__ . '/includes/seo-audit.php';
require_once __DIR__ . '/includes/translation-audit.php';
require_once __DIR__ . '/includes/menus.php';
require_once __DIR__ . '/includes/indexnow.php';
require_once __DIR__ . '/includes/updater.php';

/* -------------------------------------------------------------------------
 * Kurulum: rastgele token uret
 * ---------------------------------------------------------------------- */

register_activation_hook( __FILE__, 'dpdai_bridge_activate' );
function dpdai_bridge_activate() {
	if ( ! get_option( DPDAI_TOKEN_OPTION ) ) {
		update_option( DPDAI_TOKEN_OPTION, wp_generate_password( 48, false, false ), false );
	}
}

/* -------------------------------------------------------------------------
 * Yetkilendirme
 * ---------------------------------------------------------------------- */

/**
 * Iki yol kabul edilir:
 *  1) X-DPDAI-Token basligi, Araclar > DPDAI Bridge sayfasindaki token ile eslesir.
 *  2) Uygulama Sifresi ile giris yapmis, publish_posts yetkisi olan kullanici.
 */
function dpdai_bridge_permission( WP_REST_Request $request ) {
	$stored = (string) get_option( DPDAI_TOKEN_OPTION, '' );
	$sent   = (string) $request->get_header( 'x-dpdai-token' );

	if ( $stored !== '' && $sent !== '' && hash_equals( $stored, $sent ) ) {
		return true;
	}

	if ( current_user_can( 'publish_posts' ) ) {
		return true;
	}

	return new WP_Error(
		'dpdai_forbidden',
		'Yetkisiz istek. X-DPDAI-Token basligini gonderin veya uygulama sifresi ile kimlik dogrulayin.',
		array( 'status' => 401 )
	);
}

/* -------------------------------------------------------------------------
 * Ortam tespiti
 * ---------------------------------------------------------------------- */

function dpdai_detect_seo_plugin() {
	if ( defined( 'WPSEO_VERSION' ) || class_exists( 'WPSEO_Options' ) ) {
		return 'YOAST';
	}
	if ( defined( 'RANK_MATH_VERSION' ) || class_exists( 'RankMath' ) ) {
		return 'RANKMATH';
	}
	return 'NONE';
}

function dpdai_detect_i18n() {
	if ( function_exists( 'pll_languages_list' ) ) {
		return array(
			'mode'      => 'polylang',
			'languages' => array_values( (array) pll_languages_list() ),
		);
	}
	if ( defined( 'ICL_SITEPRESS_VERSION' ) ) {
		$langs = apply_filters( 'wpml_active_languages', null, array( 'skip_missing' => 0 ) );
		return array(
			'mode'      => 'wpml',
			'languages' => is_array( $langs ) ? array_values( array_keys( $langs ) ) : array(),
		);
	}
	return array(
		'mode'      => 'none',
		'languages' => array(),
	);
}

/* -------------------------------------------------------------------------
 * REST uclari
 * ---------------------------------------------------------------------- */

add_action( 'rest_api_init', 'dpdai_bridge_routes' );
function dpdai_bridge_routes() {
	register_rest_route(
		'dpdai/v1',
		'/info',
		array(
			'methods'             => 'GET',
			'callback'            => 'dpdai_route_info',
			'permission_callback' => 'dpdai_bridge_permission',
		)
	);

	register_rest_route(
		'dpdai/v1',
		'/seo-audit',
		array(
			'methods'             => 'GET',
			'callback'            => 'dpdai_route_seo_audit',
			'permission_callback' => 'dpdai_bridge_permission',
		)
	);

	register_rest_route(
		'dpdai/v1',
		'/publish',
		array(
			'methods'             => 'POST',
			'callback'            => 'dpdai_route_publish',
			'permission_callback' => 'dpdai_bridge_permission',
		)
	);
}

function dpdai_route_info() {
	global $wp_version;

	$categories = array();
	foreach ( get_categories( array( 'hide_empty' => false, 'number' => 200 ) ) as $c ) {
		$categories[] = array(
			'id'   => (int) $c->term_id,
			'name' => $c->name,
			'slug' => $c->slug,
		);
	}

	$authors = array();
	foreach ( get_users( array( 'capability' => array( 'publish_posts' ), 'number' => 100 ) ) as $u ) {
		$authors[] = array(
			'id'   => (int) $u->ID,
			'name' => $u->display_name,
		);
	}

	return rest_ensure_response(
		array(
			'version'    => DPDAI_BRIDGE_VERSION,
			'wp_version' => $wp_version,
			'site_url'   => get_site_url(),
			'seo_plugin'   => dpdai_detect_seo_plugin(),
			'i18n'         => dpdai_detect_i18n(),
			'indexnow_key' => dpdai_indexnow_key(),
			'categories'   => $categories,
			'authors'      => $authors,
		)
	);
}

function dpdai_route_publish( WP_REST_Request $request ) {
	$body        = $request->get_json_params();
	$external_id = isset( $body['external_id'] ) ? sanitize_text_field( $body['external_id'] ) : '';
	$post_in     = isset( $body['post'] ) && is_array( $body['post'] ) ? $body['post'] : array();
	$seo_in      = isset( $body['seo'] ) && is_array( $body['seo'] ) ? $body['seo'] : array();
	$i18n_in     = isset( $body['i18n'] ) && is_array( $body['i18n'] ) ? $body['i18n'] : array();
	$warnings    = array();

	if ( $external_id === '' ) {
		return new WP_Error( 'dpdai_bad_request', 'external_id zorunlu.', array( 'status' => 400 ) );
	}
	if ( empty( $post_in['title'] ) ) {
		return new WP_Error( 'dpdai_bad_request', 'post.title zorunlu.', array( 'status' => 400 ) );
	}

	// --- Idempotency: ayni external_id daha once islendiyse guncelle
	$existing_id = dpdai_find_post_by_external_id( $external_id );

	$status = isset( $post_in['status'] ) ? sanitize_key( $post_in['status'] ) : 'draft';
	if ( ! in_array( $status, array( 'draft', 'publish', 'pending', 'future', 'private' ), true ) ) {
		$status = 'draft';
	}

	$postarr = array(
		'post_title'   => wp_strip_all_tags( (string) $post_in['title'] ),
		'post_content' => isset( $post_in['content'] ) ? (string) $post_in['content'] : '',
		'post_excerpt' => isset( $post_in['excerpt'] ) ? sanitize_textarea_field( (string) $post_in['excerpt'] ) : '',
		'post_status'  => $status,
		'post_type'    => 'post',
	);

	if ( ! empty( $post_in['slug'] ) ) {
		$postarr['post_name'] = sanitize_title( (string) $post_in['slug'] );
	}
	if ( ! empty( $post_in['date'] ) ) {
		$postarr['post_date']     = get_date_from_gmt( gmdate( 'Y-m-d H:i:s', strtotime( (string) $post_in['date'] ) ) );
		$postarr['post_date_gmt'] = gmdate( 'Y-m-d H:i:s', strtotime( (string) $post_in['date'] ) );
	}
	if ( ! empty( $post_in['author'] ) ) {
		$postarr['post_author'] = (int) $post_in['author'];
	}

	if ( $existing_id ) {
		$postarr['ID'] = $existing_id;
		$post_id       = wp_update_post( $postarr, true );
	} else {
		$post_id = wp_insert_post( $postarr, true );
	}

	if ( is_wp_error( $post_id ) ) {
		return new WP_Error( 'dpdai_insert_failed', $post_id->get_error_message(), array( 'status' => 500 ) );
	}

	update_post_meta( $post_id, DPDAI_EXTERNAL_ID_META, $external_id );

	// --- Taksonomiler (ada gore bul, yoksa olustur)
	if ( ! empty( $post_in['categories'] ) && is_array( $post_in['categories'] ) ) {
		$ids = dpdai_resolve_terms( $post_in['categories'], 'category' );
		if ( $ids ) {
			wp_set_post_categories( $post_id, $ids, false );
		}
	}
	if ( ! empty( $post_in['tags'] ) && is_array( $post_in['tags'] ) ) {
		wp_set_post_tags( $post_id, array_map( 'sanitize_text_field', $post_in['tags'] ), false );
	}

	// --- One cikan gorsel
	if ( ! empty( $post_in['featured_media'] ) ) {
		set_post_thumbnail( $post_id, (int) $post_in['featured_media'] );
	}

	// --- SEO metalari
	$warnings = array_merge( $warnings, dpdai_write_seo( $post_id, $seo_in ) );

	// --- Dil baglantisi
	$warnings = array_merge( $warnings, dpdai_apply_i18n( $post_id, $i18n_in ) );

	return rest_ensure_response(
		array(
			'id'       => (int) $post_id,
			'link'     => get_permalink( $post_id ),
			'status'   => get_post_status( $post_id ),
			'edit_url' => get_edit_post_link( $post_id, 'raw' ),
			'warnings' => $warnings,
		)
	);
}

/* -------------------------------------------------------------------------
 * Yardimcilar
 * ---------------------------------------------------------------------- */

function dpdai_find_post_by_external_id( $external_id ) {
	$q = new WP_Query(
		array(
			'post_type'              => 'post',
			'post_status'            => 'any',
			'posts_per_page'         => 1,
			'fields'                 => 'ids',
			'no_found_rows'          => true,
			'update_post_term_cache' => false,
			'meta_query'             => array(
				array(
					'key'   => DPDAI_EXTERNAL_ID_META,
					'value' => $external_id,
				),
			),
		)
	);
	return $q->have_posts() ? (int) $q->posts[0] : 0;
}

function dpdai_resolve_terms( $names, $taxonomy ) {
	$ids = array();
	foreach ( (array) $names as $name ) {
		$name = sanitize_text_field( (string) $name );
		if ( $name === '' ) {
			continue;
		}
		$term = get_term_by( 'name', $name, $taxonomy );
		if ( ! $term ) {
			$created = wp_insert_term( $name, $taxonomy );
			if ( is_wp_error( $created ) ) {
				continue;
			}
			$ids[] = (int) $created['term_id'];
		} else {
			$ids[] = (int) $term->term_id;
		}
	}
	return $ids;
}

/**
 * SEO metalarini kurulu eklentiye gore yazar.
 * Hicbiri yoksa kendi metalarimiza yazar ve wp_head ile basar.
 */
function dpdai_write_seo( $post_id, $seo ) {
	$warnings = array();
	if ( empty( $seo ) ) {
		return $warnings;
	}

	$title       = isset( $seo['metaTitle'] ) ? sanitize_text_field( $seo['metaTitle'] ) : '';
	$description = isset( $seo['metaDescription'] ) ? sanitize_textarea_field( $seo['metaDescription'] ) : '';
	$keyword     = isset( $seo['focusKeyword'] ) ? sanitize_text_field( $seo['focusKeyword'] ) : '';
	$canonical   = isset( $seo['canonical'] ) ? esc_url_raw( $seo['canonical'] ) : '';
	$og_title    = isset( $seo['ogTitle'] ) ? sanitize_text_field( $seo['ogTitle'] ) : $title;
	$og_desc     = isset( $seo['ogDescription'] ) ? sanitize_textarea_field( $seo['ogDescription'] ) : $description;
	$schema      = isset( $seo['schema'] ) && is_array( $seo['schema'] ) ? $seo['schema'] : null;

	switch ( dpdai_detect_seo_plugin() ) {
		case 'YOAST':
			if ( $title ) {
				update_post_meta( $post_id, '_yoast_wpseo_title', $title );
			}
			if ( $description ) {
				update_post_meta( $post_id, '_yoast_wpseo_metadesc', $description );
			}
			if ( $keyword ) {
				update_post_meta( $post_id, '_yoast_wpseo_focuskw', $keyword );
			}
			if ( $canonical ) {
				update_post_meta( $post_id, '_yoast_wpseo_canonical', $canonical );
			}
			if ( $og_title ) {
				update_post_meta( $post_id, '_yoast_wpseo_opengraph-title', $og_title );
			}
			if ( $og_desc ) {
				update_post_meta( $post_id, '_yoast_wpseo_opengraph-description', $og_desc );
			}
			break;

		case 'RANKMATH':
			if ( $title ) {
				update_post_meta( $post_id, 'rank_math_title', $title );
			}
			if ( $description ) {
				update_post_meta( $post_id, 'rank_math_description', $description );
			}
			if ( $keyword ) {
				update_post_meta( $post_id, 'rank_math_focus_keyword', $keyword );
			}
			if ( $canonical ) {
				update_post_meta( $post_id, 'rank_math_canonical_url', $canonical );
			}
			break;

		default:
			// SEO eklentisi yok: metalari biz tutar, biz basariz
			$warnings[] = 'Sitede SEO eklentisi bulunamadi; meta etiketleri DPDAI Bridge tarafindan basiliyor.';
			break;
	}

	// Her durumda kendi kopyamizi da sakla (panelde geri okumak icin).
	//
	// ONEMLI: update_post_meta deger uzerinde wp_unslash calistirir. Duz
	// wp_json_encode ciktisi Turkce harfleri ö gibi kacislarla yazar;
	// wp_unslash ters bolu isaretini silince ö -> u00f6 olur ve metin
	// bozulur. Bunu onlemek icin JSON_UNESCAPED_UNICODE ile gercek UTF-8
	// yazariz ve update_post_meta'nin bekledigi gibi wp_slash ile sararız.
	update_post_meta(
		$post_id,
		'_dpdai_seo',
		wp_slash( wp_json_encode( $seo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) )
	);
	if ( $schema ) {
		update_post_meta(
			$post_id,
			'_dpdai_schema',
			wp_slash( wp_json_encode( $schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) )
		);
	}

	return $warnings;
}

/**
 * Ceviri yazilarini orijinaline baglar.
 */
function dpdai_apply_i18n( $post_id, $i18n ) {
	$warnings = array();
	$mode     = isset( $i18n['mode'] ) ? sanitize_key( $i18n['mode'] ) : 'none';
	$lang     = isset( $i18n['lang'] ) ? sanitize_key( $i18n['lang'] ) : '';
	$source   = isset( $i18n['translationOfPostId'] ) ? (int) $i18n['translationOfPostId'] : 0;

	if ( $mode === 'none' || $lang === '' ) {
		return $warnings;
	}

	if ( $mode === 'polylang' ) {
		if ( ! function_exists( 'pll_set_post_language' ) ) {
			return array( 'Polylang bu sitede kurulu degil; dil atanamadi.' );
		}
		pll_set_post_language( $post_id, $lang );

		if ( $source && function_exists( 'pll_save_post_translations' ) && function_exists( 'pll_get_post_language' ) ) {
			$source_lang = pll_get_post_language( $source );
			if ( $source_lang ) {
				$map = function_exists( 'pll_get_post_translations' ) ? pll_get_post_translations( $source ) : array();
				$map[ $source_lang ] = $source;
				$map[ $lang ]        = $post_id;
				pll_save_post_translations( $map );
			} else {
				$warnings[] = 'Kaynak yazinin dili Polylang tarafindan bilinmiyor; ceviri baglantisi kurulamadi.';
			}
		}
		return $warnings;
	}

	if ( $mode === 'wpml' ) {
		if ( ! defined( 'ICL_SITEPRESS_VERSION' ) ) {
			return array( 'WPML bu sitede kurulu degil; dil atanamadi.' );
		}
		$trid = null;
		if ( $source ) {
			$source_details = apply_filters( 'wpml_element_language_details', null, array(
				'element_id'   => $source,
				'element_type' => 'post_post',
			) );
			if ( $source_details && isset( $source_details->trid ) ) {
				$trid = $source_details->trid;
			}
		}
		do_action( 'wpml_set_element_language_details', array(
			'element_id'           => $post_id,
			'element_type'         => 'post_post',
			'trid'                 => $trid,
			'language_code'        => $lang,
			'source_language_code' => $trid ? apply_filters( 'wpml_default_language', null ) : null,
		) );
		return $warnings;
	}

	return array( sprintf( 'Bilinmeyen dil modu: %s', $mode ) );
}

/* -------------------------------------------------------------------------
 * SEO eklentisi yoksa meta etiketlerini biz basariz
 * ---------------------------------------------------------------------- */

add_action( 'wp_head', 'dpdai_render_head', 1 );
function dpdai_render_head() {
	if ( ! is_singular( 'post' ) ) {
		return;
	}
	if ( dpdai_detect_seo_plugin() !== 'NONE' ) {
		return; // eklenti varsa ona karisma
	}

	$post_id = get_the_ID();
	$raw     = get_post_meta( $post_id, '_dpdai_seo', true );
	if ( ! $raw ) {
		return;
	}
	$seo = json_decode( $raw, true );
	if ( ! is_array( $seo ) ) {
		return;
	}

	if ( ! empty( $seo['metaDescription'] ) ) {
		printf( "<meta name=\"description\" content=\"%s\" />\n", esc_attr( $seo['metaDescription'] ) );
	}
	if ( ! empty( $seo['canonical'] ) ) {
		printf( "<link rel=\"canonical\" href=\"%s\" />\n", esc_url( $seo['canonical'] ) );
	}
	if ( ! empty( $seo['ogTitle'] ) ) {
		printf( "<meta property=\"og:title\" content=\"%s\" />\n", esc_attr( $seo['ogTitle'] ) );
	}
	if ( ! empty( $seo['ogDescription'] ) ) {
		printf( "<meta property=\"og:description\" content=\"%s\" />\n", esc_attr( $seo['ogDescription'] ) );
	}
	printf( "<meta property=\"og:type\" content=\"article\" />\n" );

	$schema_raw = get_post_meta( $post_id, '_dpdai_schema', true );
	if ( $schema_raw ) {
		printf(
			"<script type=\"application/ld+json\">%s</script>\n",
			wp_kses_post( $schema_raw )
		);
	}
}

add_filter( 'document_title_parts', 'dpdai_filter_title' );
function dpdai_filter_title( $parts ) {
	if ( ! is_singular( 'post' ) || dpdai_detect_seo_plugin() !== 'NONE' ) {
		return $parts;
	}
	$raw = get_post_meta( get_the_ID(), '_dpdai_seo', true );
	if ( ! $raw ) {
		return $parts;
	}
	$seo = json_decode( $raw, true );
	if ( is_array( $seo ) && ! empty( $seo['metaTitle'] ) ) {
		$parts['title'] = $seo['metaTitle'];
		unset( $parts['tagline'] );
	}
	return $parts;
}

/* -------------------------------------------------------------------------
 * Yonetim ekrani: token goster / yenile
 * ---------------------------------------------------------------------- */

add_action( 'admin_menu', 'dpdai_admin_menu' );
function dpdai_admin_menu() {
	add_management_page(
		'DPDAI Bridge',
		'DPDAI Bridge',
		'manage_options',
		'dpdai-bridge',
		'dpdai_admin_page'
	);
}

function dpdai_admin_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		wp_die( 'Yetkisiz.' );
	}

	if ( isset( $_POST['dpdai_regen'] ) && check_admin_referer( 'dpdai_regen_token' ) ) {
		update_option( DPDAI_TOKEN_OPTION, wp_generate_password( 48, false, false ), false );
		echo '<div class="notice notice-success"><p>Yeni token uretildi. Panelde guncelleyin.</p></div>';
	}

	if ( isset( $_POST['dpdai_panel'] ) && check_admin_referer( 'dpdai_save_panel' ) ) {
		$url = esc_url_raw( wp_unslash( $_POST['dpdai_panel_url'] ?? '' ) );
		update_option( DPDAI_PANEL_OPTION, untrailingslashit( $url ), false );
		dpdai_force_update_check();
		echo '<div class="notice notice-success"><p>Panel adresi kaydedildi.</p></div>';
	}

	if ( isset( $_POST['dpdai_check'] ) && check_admin_referer( 'dpdai_save_panel' ) ) {
		$bilgi = dpdai_force_update_check();
		if ( ! $bilgi ) {
			echo '<div class="notice notice-error"><p>Panele ulasilamadi. Adresi kontrol edin.</p></div>';
		} elseif ( version_compare( $bilgi['version'], DPDAI_BRIDGE_VERSION, '>' ) ) {
			printf(
				'<div class="notice notice-warning"><p>Yeni surum var: <strong>%s</strong>. Eklentiler ekranindan guncelleyebilirsiniz.</p></div>',
				esc_html( $bilgi['version'] )
			);
		} else {
			echo '<div class="notice notice-success"><p>Eklenti guncel.</p></div>';
		}
	}

	$token = get_option( DPDAI_TOKEN_OPTION, '' );
	$i18n  = dpdai_detect_i18n();
	?>
	<div class="wrap">
		<h1>DPDAI Bridge</h1>
		<p>Bu eklenti blog otomasyon panelinin bu siteye SEO uyumlu yazi gondermesini saglar.</p>

		<h2>Baglanti bilgileri</h2>
		<table class="form-table">
			<tr>
				<th>REST adresi</th>
				<td><code><?php echo esc_html( get_rest_url( null, 'dpdai/v1' ) ); ?></code></td>
			</tr>
			<tr>
				<th>Token</th>
				<td>
					<input type="text" readonly value="<?php echo esc_attr( $token ); ?>" style="width:32rem;font-family:monospace" onclick="this.select()" />
					<p class="description">Panelde <strong>Site &gt; Bridge Token</strong> alanina yapistirin. Kimseyle paylasmayin.</p>
				</td>
			</tr>
			<tr>
				<th>SEO eklentisi</th>
				<td><code><?php echo esc_html( dpdai_detect_seo_plugin() ); ?></code></td>
			</tr>
			<tr>
				<th>Cok dil</th>
				<td>
					<code><?php echo esc_html( $i18n['mode'] ); ?></code>
					<?php if ( ! empty( $i18n['languages'] ) ) : ?>
						&mdash; <?php echo esc_html( implode( ', ', $i18n['languages'] ) ); ?>
					<?php endif; ?>
				</td>
			</tr>
		</table>

		<h2>Panel baglantisi ve guncelleme</h2>
		<p>
			Panel adresi ilk basarili istekte kendiliginden kaydedilir. Elle degistirmek
			isterseniz asagidan girebilirsiniz. Bu adres yalnizca guncelleme kontrolu icin
			kullanilir.
		</p>
		<form method="post">
			<?php wp_nonce_field( 'dpdai_save_panel' ); ?>
			<table class="form-table">
				<tr>
					<th><label for="dpdai_panel_url">Panel adresi</label></th>
					<td>
						<input type="url" id="dpdai_panel_url" name="dpdai_panel_url"
							value="<?php echo esc_attr( dpdai_panel_url() ); ?>"
							style="width:26rem" placeholder="https://panel.ornek.com" />
					</td>
				</tr>
				<tr>
					<th>Kurulu surum</th>
					<td><code><?php echo esc_html( DPDAI_BRIDGE_VERSION ); ?></code></td>
				</tr>
			</table>
			<p>
				<button type="submit" name="dpdai_panel" value="1" class="button button-primary">Kaydet</button>
				<button type="submit" name="dpdai_check" value="1" class="button">Guncelleme kontrol et</button>
			</p>
		</form>

		<h2>SEO denetimi</h2>
		<p>
			Panel, <code><?php echo esc_html( get_rest_url( null, 'dpdai/v1/seo-audit' ) ); ?></code>
			ucundan bu sitenin indeksleme, teknik, icerik ve meta durumunu okur.
		</p>

		<form method="post">
			<?php wp_nonce_field( 'dpdai_regen_token' ); ?>
			<p><button type="submit" name="dpdai_regen" value="1" class="button button-secondary"
				onclick="return confirm('Token yenilenecek. Paneldeki eski token calismayi birakacak. Devam?')">
				Token'i yenile
			</button></p>
		</form>
	</div>
	<?php
}
