<?php
/**
 * Ceviri denetimi ucu.
 *
 * Sitedeki yayinlanmis icerigi (yazi + sayfa) tarar, her birinin hangi
 * dillerde oldugunu Polylang/WPML'den okur ve EKSIK cevirileri raporlar.
 * Panel bu rapordan eksikleri kuyruga atip tamamlar.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'dpdai_translation_routes' );
function dpdai_translation_routes() {
	register_rest_route(
		'dpdai/v1',
		'/translation-audit',
		array(
			'methods'             => 'GET',
			'callback'            => 'dpdai_route_translation_audit',
			'permission_callback' => 'dpdai_bridge_permission',
		)
	);

	// Tek bir yazinin cevrilecek KAYNAK icerigini dondurur (panel ceviriyi bundan uretir)
	register_rest_route(
		'dpdai/v1',
		'/post-source/(?P<id>\d+)',
		array(
			'methods'             => 'GET',
			'callback'            => 'dpdai_route_post_source',
			'permission_callback' => 'dpdai_bridge_permission',
		)
	);
}

/**
 * Polylang'in CEVIRDIGI tum public icerik turlerini dondurur:
 * yazi, sayfa, urun (WooCommerce) ve diger ozel icerik turleri.
 * Polylang'in cevirmedigi turler (yanlis "eksik" saymamak icin) elenir.
 */
function dpdai_translatable_types() {
	$out = array();
	foreach ( get_post_types( array( 'public' => true ), 'names' ) as $t ) {
		if ( $t === 'attachment' ) {
			continue;
		}
		// Polylang bu turu ceviriyor mu? Fonksiyon yoksa dahil et, alttaki dil
		// kontrolu yine de cevrilmeyenleri eler.
		if ( function_exists( 'pll_is_translated_post_type' ) && ! pll_is_translated_post_type( $t ) ) {
			continue;
		}
		$out[] = $t;
	}
	return $out ? $out : array( 'post', 'page' );
}

/** Yayinlanmis tum cevrilebilir icerigi kapsamiyla dondurur. */
function dpdai_route_translation_audit( WP_REST_Request $request ) {
	$types = dpdai_translatable_types();

	// --- Polylang
	if ( function_exists( 'pll_languages_list' ) ) {
		return rest_ensure_response( dpdai_audit_polylang( $types ) );
	}

	// --- WPML (temel destek)
	if ( defined( 'ICL_SITEPRESS_VERSION' ) ) {
		return rest_ensure_response( dpdai_audit_wpml( $types ) );
	}

	return rest_ensure_response(
		array(
			'mode'      => 'none',
			'supported' => false,
			'message'   => 'Sitede çok dil eklentisi (Polylang/WPML) bulunamadı. Çeviri denetimi için Polylang kurun.',
		)
	);
}

/** Bir yazinin metin uzunlugu (gorunur karakter) - bozuk ceviri tespiti icin. */
function dpdai_body_len( $post_id ) {
	$p = get_post( $post_id );
	if ( ! $p ) {
		return 0;
	}
	return mb_strlen( trim( wp_strip_all_tags( $p->post_content ) ) );
}

function dpdai_audit_polylang( $types ) {
	$langs   = array_values( (array) pll_languages_list() );
	$default = function_exists( 'pll_default_language' ) ? pll_default_language() : ( $langs[0] ?? '' );

	$post_ids = get_posts(
		array(
			'post_type'   => $types,
			'post_status' => 'publish',
			'numberposts' => 3000,
			'fields'      => 'ids',
		)
	);

	$groups = array(); // kanonik anahtar => grup
	foreach ( $post_ids as $pid ) {
		// Dili olmayan icerik (Polylang'in cevirmedigi tur) yanlislikla "eksik" sayilmasin
		$plang = function_exists( 'pll_get_post_language' ) ? pll_get_post_language( $pid ) : '';
		if ( ! $plang ) {
			continue;
		}

		$tr = function_exists( 'pll_get_post_translations' ) ? pll_get_post_translations( $pid ) : array();
		if ( empty( $tr ) ) {
			$tr = array( $plang => $pid );
		}

		// Yalnizca gecerli (var olan, yayinda) uyeler
		$members = array();
		foreach ( $tr as $lang => $tid ) {
			$tid = (int) $tid;
			if ( $tid > 0 && get_post_status( $tid ) === 'publish' ) {
				$members[ $lang ] = $tid;
			}
		}
		if ( empty( $members ) ) {
			continue;
		}

		// Grubu tek sefer isle
		$member_ids = array_values( $members );
		sort( $member_ids );
		$key = implode( '-', $member_ids );
		if ( isset( $groups[ $key ] ) ) {
			continue;
		}

		$source_lang    = isset( $members[ $default ] ) ? $default : array_key_first( $members );
		$groups[ $key ] = array(
			'members'     => $members,
			'source_id'   => $members[ $source_lang ],
			'source_lang' => $source_lang,
		);
	}

	$items    = array();
	$problems = array();
	$coverage = array_fill_keys( $langs, 0 );
	$missing  = array_fill_keys( $langs, 0 );

	foreach ( $groups as $g ) {
		$present = array_keys( $g['members'] );
		foreach ( $present as $l ) {
			if ( isset( $coverage[ $l ] ) ) {
				++$coverage[ $l ];
			}
		}

		$src     = $g['source_id'];
		$src_len = dpdai_body_len( $src );

		// --- EKSIK ceviriler
		$miss = array_values( array_diff( $langs, $present ) );
		foreach ( $miss as $l ) {
			if ( isset( $missing[ $l ] ) ) {
				++$missing[ $l ];
			}
		}
		if ( $miss ) {
			$items[] = array(
				'source_id'   => $src,
				'source_lang' => $g['source_lang'],
				'title'       => get_the_title( $src ),
				'url'         => get_permalink( $src ),
				'type'        => get_post_type( $src ),
				'missing'     => $miss,
			);
		}

		// --- VAR AMA BOZUK/EKSIK ceviriler (gövde bos ya da kaynaktan cok kisa)
		foreach ( $g['members'] as $lang => $tid ) {
			if ( $lang === $g['source_lang'] ) {
				continue;
			}
			$len = dpdai_body_len( $tid );
			if ( $src_len > 200 && ( $len === 0 || $len < $src_len * 0.4 ) ) {
				$problems[] = array(
					'post_id'     => $tid,
					'lang'        => $lang,
					'title'       => get_the_title( $tid ),
					'url'         => get_permalink( $tid ),
					'source_id'   => $src,
					'source_lang' => $g['source_lang'],
					'reason'      => $len === 0 ? 'boş çeviri' : 'kaynaktan çok kısa (eksik olabilir)',
					'ratio'       => $src_len ? round( $len / $src_len, 2 ) : 0,
				);
			}
		}
	}

	return array(
		'mode'      => 'polylang',
		'supported' => true,
		'languages' => $langs,
		'default'   => $default,
		'summary'   => array(
			'total_groups' => count( $groups ),
			'coverage'     => $coverage,
			'missing'      => $missing,
			'problems'     => count( $problems ),
		),
		'items'     => $items,
		'problems'  => $problems,
	);
}

function dpdai_audit_wpml( $types ) {
	$langs_raw = apply_filters( 'wpml_active_languages', null, array( 'skip_missing' => 0 ) );
	$langs     = is_array( $langs_raw ) ? array_values( array_keys( $langs_raw ) ) : array();
	$default   = apply_filters( 'wpml_default_language', null );

	// WPML'de tam kapsam icin trid gezilir; burada temel bir surum:
	return array(
		'mode'      => 'wpml',
		'supported' => true,
		'languages' => $langs,
		'default'   => $default,
		'summary'   => array( 'total_groups' => 0, 'coverage' => array(), 'missing' => array() ),
		'items'     => array(),
		'message'   => 'WPML kapsam raporu sınırlıdır; Polylang önerilir.',
	);
}

/** Tek yazinin cevrilecek kaynak icerigini dondurur. */
function dpdai_route_post_source( WP_REST_Request $request ) {
	$id   = (int) $request['id'];
	$post = get_post( $id );
	if ( ! $post || $post->post_status !== 'publish' ) {
		return new WP_Error( 'dpdai_not_found', 'Yazı bulunamadı.', array( 'status' => 404 ) );
	}

	$lang = function_exists( 'pll_get_post_language' ) ? pll_get_post_language( $id ) : '';

	return rest_ensure_response(
		array(
			'id'          => $id,
			'lang'        => $lang,
			'title'       => get_the_title( $id ),
			'slug'        => $post->post_name,
			'contentHtml' => apply_filters( 'the_content', $post->post_content ),
			'raw'         => $post->post_content,
			'excerpt'     => $post->post_excerpt,
			'type'        => $post->post_type,
			'categories'  => wp_get_post_categories( $id, array( 'fields' => 'names' ) ),
		)
	);
}
