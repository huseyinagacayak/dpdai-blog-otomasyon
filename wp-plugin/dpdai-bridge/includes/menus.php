<?php
/**
 * Menu cevirisi (Polylang).
 *
 * Icerik cevirisinden ayri: sitenin NAVIGASYON menusunu her dile kopyalar.
 *  - Sayfa/kategori ogeleri, o dildeki CEVRILMIS karsiligina baglanir
 *    (pll_get_post / pll_get_term), etiketi cevrilmis basliktir.
 *  - Ozel (custom) URL ogelerinin etiketi panelden gelen ceviri haritasindan
 *    yazilir; ana sayfa URL'i /<lang>/ ile onceklenir.
 *  - Olusan menu, o dil icin ayni tema konumuna atanir + dil degistirici eklenir.
 *
 * GET  /dpdai/v1/menus         -> menuleri + ogeleri + konumlari dondurur
 * POST /dpdai/v1/sync-menus    -> cevrilmis menuleri olusturur ve atar
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action( 'rest_api_init', 'dpdai_menu_routes' );
function dpdai_menu_routes() {
	register_rest_route(
		'dpdai/v1',
		'/menus',
		array(
			'methods'             => 'GET',
			'callback'            => 'dpdai_route_menus',
			'permission_callback' => 'dpdai_bridge_permission',
		)
	);
	register_rest_route(
		'dpdai/v1',
		'/sync-menus',
		array(
			'methods'             => 'POST',
			'callback'            => 'dpdai_route_sync_menus',
			'permission_callback' => 'dpdai_bridge_permission',
		)
	);
}

/** Tema konumlarina atali menuleri ve ogelerini dondurur (varsayilan dil). */
function dpdai_route_menus( WP_REST_Request $request ) {
	if ( ! function_exists( 'pll_languages_list' ) ) {
		return rest_ensure_response( array( 'supported' => false, 'message' => 'Polylang gerekli.' ) );
	}

	$theme     = get_stylesheet();
	$locations = get_nav_menu_locations();
	$default   = function_exists( 'pll_default_language' ) ? pll_default_language() : '';

	$menus = array();
	foreach ( $locations as $location => $menu_id ) {
		$menu_id = (int) $menu_id;
		if ( ! $menu_id ) {
			continue;
		}
		$term = wp_get_nav_menu_object( $menu_id );
		if ( ! $term ) {
			continue;
		}
		$items = wp_get_nav_menu_items( $menu_id );
		if ( ! $items ) {
			$items = array();
		}

		$out_items = array();
		foreach ( $items as $it ) {
			$out_items[] = array(
				'id'         => (int) $it->ID,
				'title'      => $it->title,
				'type'       => $it->type,          // custom | post_type | taxonomy
				'object'     => $it->object,        // page | post | category ...
				'object_id'  => (int) $it->object_id,
				'url'        => $it->url,
				'parent'     => (int) $it->menu_item_parent,
				'order'      => (int) $it->menu_order,
			);
		}

		$menus[] = array(
			'menu_id'  => $menu_id,
			'name'     => $term->name,
			'location' => $location,
			'items'    => $out_items,
		);
	}

	return rest_ensure_response(
		array(
			'supported' => true,
			'theme'     => $theme,
			'default'   => $default,
			'languages' => array_values( (array) pll_languages_list() ),
			'menus'     => $menus,
		)
	);
}

/**
 * Cevrilmis menuleri olusturur/gunceller ve dile atar.
 *
 * Govde:
 * {
 *   "langs": ["en","fr","ar"],
 *   "labels": { "en": { "<sourceItemId>": "Home", ... }, ... }  // ozel oge etiketleri
 * }
 */
function dpdai_route_sync_menus( WP_REST_Request $request ) {
	if ( ! function_exists( 'pll_languages_list' ) ) {
		return new WP_Error( 'dpdai_no_pll', 'Polylang gerekli.', array( 'status' => 400 ) );
	}

	$body   = $request->get_json_params();
	$langs  = isset( $body['langs'] ) && is_array( $body['langs'] ) ? $body['langs'] : array();
	$labels = isset( $body['labels'] ) && is_array( $body['labels'] ) ? $body['labels'] : array();

	$theme     = get_stylesheet();
	$default   = function_exists( 'pll_default_language' ) ? pll_default_language() : '';
	$locations = get_nav_menu_locations();
	$results   = array();

	foreach ( $locations as $location => $src_menu_id ) {
		$src_menu_id = (int) $src_menu_id;
		if ( ! $src_menu_id ) {
			continue;
		}
		$src_term  = wp_get_nav_menu_object( $src_menu_id );
		$src_items = wp_get_nav_menu_items( $src_menu_id );
		if ( ! $src_term || ! $src_items ) {
			continue;
		}

		foreach ( $langs as $lang ) {
			if ( $lang === $default ) {
				continue;
			}

			$menu_name = $src_term->name . ' [' . strtoupper( $lang ) . ']';
			$existing  = wp_get_nav_menu_object( $menu_name );
			$new_menu_id = $existing ? (int) $existing->term_id : (int) wp_create_nav_menu( $menu_name );
			if ( is_wp_error( $new_menu_id ) || ! $new_menu_id ) {
				continue;
			}

			// Var olan ogeleri temizle (yeniden kur)
			foreach ( (array) wp_get_nav_menu_items( $new_menu_id ) as $old ) {
				wp_delete_post( $old->ID, true );
			}

			$id_map     = array(); // eski oge id -> yeni oge id (hiyerarsi icin)
			$label_map  = isset( $labels[ $lang ] ) && is_array( $labels[ $lang ] ) ? $labels[ $lang ] : array();
			$added      = 0;

			foreach ( $src_items as $it ) {
				$args = array(
					'menu-item-status' => 'publish',
					'menu-item-position' => (int) $it->menu_order,
					'menu-item-parent-id' => isset( $id_map[ (int) $it->menu_item_parent ] ) ? $id_map[ (int) $it->menu_item_parent ] : 0,
				);

				$title = isset( $label_map[ (string) $it->ID ] ) ? (string) $label_map[ (string) $it->ID ] : $it->title;

				if ( $it->type === 'post_type' ) {
					$tid = function_exists( 'pll_get_post' ) ? pll_get_post( (int) $it->object_id, $lang ) : 0;
					if ( ! $tid ) {
						continue; // o dilde cevirisi yok -> menuye ekleme
					}
					$args['menu-item-type']      = 'post_type';
					$args['menu-item-object']    = $it->object;
					$args['menu-item-object-id'] = (int) $tid;
					$args['menu-item-title']     = $title; // cevrilmis etiket ya da kaynak
				} elseif ( $it->type === 'taxonomy' ) {
					$ttid = function_exists( 'pll_get_term' ) ? pll_get_term( (int) $it->object_id, $lang ) : 0;
					if ( ! $ttid ) {
						continue;
					}
					$args['menu-item-type']      = 'taxonomy';
					$args['menu-item-object']    = $it->object;
					$args['menu-item-object-id'] = (int) $ttid;
					$args['menu-item-title']     = $title;
				} else {
					// custom URL
					$url = $it->url;
					// ana sayfa linkini dil onekiyle degistir
					$home = home_url( '/' );
					if ( untrailingslashit( $url ) === untrailingslashit( $home ) ) {
						$url = home_url( '/' . $lang . '/' );
					}
					$args['menu-item-type']  = 'custom';
					$args['menu-item-url']   = $url;
					$args['menu-item-title'] = $title;
				}

				$new_item_id = wp_update_nav_menu_item( $new_menu_id, 0, $args );
				if ( ! is_wp_error( $new_item_id ) && $new_item_id ) {
					$id_map[ (int) $it->ID ] = (int) $new_item_id;
					++$added;
				}
			}

			// Dil degistirici oge ekle (Polylang)
			wp_update_nav_menu_item(
				$new_menu_id,
				0,
				array(
					'menu-item-title'  => 'Language',
					'menu-item-url'    => '#pll_switcher',
					'menu-item-type'   => 'custom',
					'menu-item-status' => 'publish',
					'menu-item-position' => 9999,
				)
			);

			// Konuma ata (Polylang, dil basina nav_menus secenekinde tutar)
			dpdai_pll_assign_menu_location( $theme, $location, $lang, $new_menu_id );

			$results[] = array(
				'location' => $location,
				'lang'     => $lang,
				'menu_id'  => $new_menu_id,
				'items'    => $added,
			);
		}
	}

	return rest_ensure_response( array( 'ok' => true, 'assigned' => $results ) );
}

/** Polylang'in dil-basina menu konumu eslemesini gunceller. */
function dpdai_pll_assign_menu_location( $theme, $location, $lang, $menu_id ) {
	$opts = get_option( 'polylang' );
	if ( ! is_array( $opts ) ) {
		return;
	}
	if ( ! isset( $opts['nav_menus'] ) || ! is_array( $opts['nav_menus'] ) ) {
		$opts['nav_menus'] = array();
	}
	if ( ! isset( $opts['nav_menus'][ $theme ] ) ) {
		$opts['nav_menus'][ $theme ] = array();
	}
	if ( ! isset( $opts['nav_menus'][ $theme ][ $location ] ) ) {
		$opts['nav_menus'][ $theme ][ $location ] = array();
	}
	$opts['nav_menus'][ $theme ][ $location ][ $lang ] = (int) $menu_id;
	update_option( 'polylang', $opts );
}
