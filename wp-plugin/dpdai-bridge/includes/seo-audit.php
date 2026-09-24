<?php
/**
 * Site geneli SEO saglik taramasi.
 * dpdai-bridge.php tarafindan yuklenir, /dpdai/v1/seo-audit ucuna hizmet eder.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Ince icerik esigi (kelime) */
const DPDAI_THIN_WORDS = 300;

function dpdai_route_seo_audit( WP_REST_Request $request ) {
	@set_time_limit( 120 );

	return rest_ensure_response(
		array(
			'version'   => DPDAI_BRIDGE_VERSION,
			'generated' => current_time( 'c' ),
			'platform'  => dpdai_audit_platform(),
			'indexing'  => dpdai_audit_indexing(),
			'technical' => dpdai_audit_technical(),
			'seoPlugin' => dpdai_audit_seo_plugin(),
			'content'   => dpdai_audit_content(),
			'taxonomy'  => dpdai_audit_taxonomy(),
			'media'     => dpdai_audit_media(),
		)
	);
}

/* -------------------------------------------------------------------- alt */

function dpdai_audit_platform() {
	global $wp_version;
	$theme = wp_get_theme();

	return array(
		'wp_version'    => $wp_version,
		'php_version'   => PHP_VERSION,
		'theme'         => $theme->get( 'Name' ),
		'theme_version' => $theme->get( 'Version' ),
		'child_theme'   => (bool) $theme->parent(),
		'site_url'      => get_site_url(),
		'home_url'      => get_home_url(),
		'is_https'      => str_starts_with( get_home_url(), 'https://' ),
		'site_title'    => get_bloginfo( 'name' ),
		'tagline'       => get_bloginfo( 'description' ),
		'language'      => get_bloginfo( 'language' ),
		'timezone'      => wp_timezone_string(),
		'multisite'     => is_multisite(),
		'debug_on'      => defined( 'WP_DEBUG' ) && WP_DEBUG,
	);
}

function dpdai_audit_indexing() {
	$robots_url = get_home_url( null, '/robots.txt' );

	// WordPress'in urettigi sanal robots.txt icerigi
	$virtual_robots = '';
	if ( function_exists( 'do_robots' ) ) {
		ob_start();
		do_action( 'do_robotstxt' );
		$virtual_robots = trim( (string) ob_get_clean() );
	}

	$front_page_id = (int) get_option( 'page_on_front' );

	return array(
		'blog_public'      => (int) get_option( 'blog_public' ), // 0 = arama motorlarina kapali
		'robots_url'       => $robots_url,
		'robots_filtered'  => $virtual_robots !== '',
		'sitemap_urls'     => dpdai_audit_sitemaps(),
		'permalink'        => get_option( 'permalink_structure' ),
		'front_page_type'  => get_option( 'show_on_front' ),
		'front_page_id'    => $front_page_id,
		'front_page_title' => $front_page_id ? get_the_title( $front_page_id ) : null,
		'posts_per_page'   => (int) get_option( 'posts_per_page' ),
	);
}

function dpdai_audit_sitemaps() {
	$urls = array();

	if ( defined( 'WPSEO_VERSION' ) ) {
		$urls[] = get_home_url( null, '/sitemap_index.xml' );
	}
	if ( defined( 'RANK_MATH_VERSION' ) ) {
		$urls[] = get_home_url( null, '/sitemap_index.xml' );
	}
	// WordPress cekirdek site haritasi (5.5+)
	if ( function_exists( 'wp_sitemaps_get_server' ) && apply_filters( 'wp_sitemaps_enabled', true ) ) {
		$urls[] = get_home_url( null, '/wp-sitemap.xml' );
	}

	return array_values( array_unique( $urls ) );
}

function dpdai_audit_technical() {
	return array(
		'object_cache'     => wp_using_ext_object_cache(),
		'cron_disabled'    => defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
		'active_plugins'   => count( (array) get_option( 'active_plugins', array() ) ),
		'has_cache_plugin' => dpdai_has_any_plugin(
			array( 'wp-rocket', 'w3-total-cache', 'wp-super-cache', 'litespeed-cache', 'wp-fastest-cache', 'autoptimize' )
		),
		'has_image_plugin' => dpdai_has_any_plugin(
			array( 'ewww-image-optimizer', 'imagify', 'shortpixel-image-optimiser', 'smush' )
		),
		'default_ping'     => (int) get_option( 'default_pingback_flag' ),
		'uploads_writable' => wp_is_writable( wp_upload_dir()['basedir'] ),
	);
}

function dpdai_has_any_plugin( array $slugs ) {
	$active = (array) get_option( 'active_plugins', array() );
	foreach ( $active as $path ) {
		$dir = strtok( $path, '/' );
		if ( in_array( $dir, $slugs, true ) ) {
			return $dir;
		}
	}
	return false;
}

function dpdai_audit_seo_plugin() {
	$plugin = dpdai_detect_seo_plugin();
	$out    = array( 'name' => $plugin, 'settings' => array() );

	if ( $plugin === 'YOAST' && class_exists( 'WPSEO_Options' ) ) {
		$titles = get_option( 'wpseo_titles', array() );
		$out['settings'] = array(
			'title_template_post' => $titles['title-post'] ?? null,
			'noindex_category'    => ! empty( $titles['noindex-tax-category'] ),
			'noindex_tag'         => ! empty( $titles['noindex-tax-post_tag'] ),
			'noindex_author'      => ! empty( $titles['noindex-author-wpseo'] ),
			'noindex_date'        => ! empty( $titles['disable-date'] ),
			'attachment_redirect' => ! empty( $titles['disable-attachment'] ),
			'separator'           => $titles['separator'] ?? null,
			'org_or_person'       => $titles['company_or_person'] ?? null,
			'org_name'            => $titles['company_name'] ?? null,
			'org_logo'            => ! empty( $titles['company_logo'] ),
		);
	}

	if ( $plugin === 'RANKMATH' ) {
		$titles = get_option( 'rank-math-options-titles', array() );
		$out['settings'] = array(
			'title_template_post' => $titles['pt_post_title'] ?? null,
			'noindex_category'    => ( $titles['noindex_tax_category'] ?? '' ) === 'on',
			'noindex_tag'         => ( $titles['noindex_tax_post_tag'] ?? '' ) === 'on',
			'noindex_author'      => ( $titles['disable_author_archives'] ?? '' ) === 'on',
			'noindex_date'        => ( $titles['disable_date_archives'] ?? '' ) === 'on',
			'attachment_redirect' => ( $titles['attachment_redirect_urls'] ?? '' ) === 'on',
			'org_name'            => $titles['knowledgegraph_name'] ?? null,
			'org_logo'            => ! empty( $titles['knowledgegraph_logo'] ),
		);
	}

	return $out;
}

function dpdai_audit_content() {
	global $wpdb;

	$counts = wp_count_posts( 'post' );

	// Meta anahtarlari eklentiye gore degisir
	switch ( dpdai_detect_seo_plugin() ) {
		case 'YOAST':
			$k_title = '_yoast_wpseo_title';
			$k_desc  = '_yoast_wpseo_metadesc';
			break;
		case 'RANKMATH':
			$k_title = 'rank_math_title';
			$k_desc  = 'rank_math_description';
			break;
		default:
			$k_title = '_dpdai_seo';
			$k_desc  = '_dpdai_seo';
	}

	$missing_title = dpdai_count_published_without_meta( $k_title );
	$missing_desc  = dpdai_count_published_without_meta( $k_desc );

	$missing_thumb = (int) $wpdb->get_var(
		"SELECT COUNT(*) FROM {$wpdb->posts} p
		 WHERE p.post_type='post' AND p.post_status='publish'
		 AND NOT EXISTS (
		   SELECT 1 FROM {$wpdb->postmeta} m
		   WHERE m.post_id=p.ID AND m.meta_key='_thumbnail_id'
		 )"
	);

	$missing_excerpt = (int) $wpdb->get_var(
		"SELECT COUNT(*) FROM {$wpdb->posts}
		 WHERE post_type='post' AND post_status='publish' AND (post_excerpt='' OR post_excerpt IS NULL)"
	);

	// Ince icerik: HTML etiketleri temizlenmis kaba kelime sayimi
	$thin = (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$wpdb->posts}
			 WHERE post_type='post' AND post_status='publish'
			 AND ( LENGTH(post_content) - LENGTH(REPLACE(post_content,' ','')) ) < %d",
			DPDAI_THIN_WORDS
		)
	);

	$dup_titles = (int) $wpdb->get_var(
		"SELECT COUNT(*) FROM (
		   SELECT post_title FROM {$wpdb->posts}
		   WHERE post_type='post' AND post_status='publish'
		   GROUP BY post_title HAVING COUNT(*) > 1
		 ) t"
	);

	$long_slugs = (int) $wpdb->get_var(
		"SELECT COUNT(*) FROM {$wpdb->posts}
		 WHERE post_type='post' AND post_status='publish'
		 AND ( LENGTH(post_name) - LENGTH(REPLACE(post_name,'-','')) ) >= 7"
	);

	$last = $wpdb->get_var(
		"SELECT post_date FROM {$wpdb->posts}
		 WHERE post_type='post' AND post_status='publish'
		 ORDER BY post_date DESC LIMIT 1"
	);

	$oldest_untouched = (int) $wpdb->get_var(
		"SELECT COUNT(*) FROM {$wpdb->posts}
		 WHERE post_type='post' AND post_status='publish'
		 AND post_modified < DATE_SUB(NOW(), INTERVAL 24 MONTH)"
	);

	return array(
		'published'          => (int) ( $counts->publish ?? 0 ),
		'draft'              => (int) ( $counts->draft ?? 0 ),
		'pages'              => (int) ( wp_count_posts( 'page' )->publish ?? 0 ),
		'missing_meta_title' => $missing_title,
		'missing_meta_desc'  => $missing_desc,
		'missing_thumbnail'  => $missing_thumb,
		'missing_excerpt'    => $missing_excerpt,
		'thin_posts'         => $thin,
		'duplicate_titles'   => $dup_titles,
		'long_slugs'         => $long_slugs,
		'last_published'     => $last,
		'stale_posts'        => $oldest_untouched,
	);
}

function dpdai_count_published_without_meta( $meta_key ) {
	global $wpdb;
	return (int) $wpdb->get_var(
		$wpdb->prepare(
			"SELECT COUNT(*) FROM {$wpdb->posts} p
			 WHERE p.post_type='post' AND p.post_status='publish'
			 AND NOT EXISTS (
			   SELECT 1 FROM {$wpdb->postmeta} m
			   WHERE m.post_id = p.ID AND m.meta_key = %s
			   AND m.meta_value <> '' AND m.meta_value IS NOT NULL
			 )",
			$meta_key
		)
	);
}

function dpdai_audit_taxonomy() {
	$cats = get_categories( array( 'hide_empty' => false, 'number' => 500 ) );

	$no_desc = 0;
	$empty   = 0;
	foreach ( $cats as $c ) {
		if ( trim( (string) $c->description ) === '' ) {
			$no_desc++;
		}
		if ( (int) $c->count === 0 ) {
			$empty++;
		}
	}

	$uncat_id    = (int) get_option( 'default_category' );
	$uncat_count = 0;
	foreach ( $cats as $c ) {
		if ( (int) $c->term_id === $uncat_id ) {
			$uncat_count = (int) $c->count;
		}
	}

	$tags = wp_count_terms( array( 'taxonomy' => 'post_tag', 'hide_empty' => false ) );

	return array(
		'categories'             => count( $cats ),
		'categories_no_desc'     => $no_desc,
		'categories_empty'       => $empty,
		'uncategorized_posts'    => $uncat_count,
		'tags'                   => is_wp_error( $tags ) ? 0 : (int) $tags,
	);
}

function dpdai_audit_media() {
	global $wpdb;

	$total = (int) $wpdb->get_var(
		"SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type='attachment' AND post_mime_type LIKE 'image/%'"
	);

	$no_alt = (int) $wpdb->get_var(
		"SELECT COUNT(*) FROM {$wpdb->posts} p
		 WHERE p.post_type='attachment' AND p.post_mime_type LIKE 'image/%'
		 AND NOT EXISTS (
		   SELECT 1 FROM {$wpdb->postmeta} m
		   WHERE m.post_id=p.ID AND m.meta_key='_wp_attachment_image_alt'
		   AND m.meta_value <> ''
		 )"
	);

	$modern = (int) $wpdb->get_var(
		"SELECT COUNT(*) FROM {$wpdb->posts}
		 WHERE post_type='attachment' AND post_mime_type IN ('image/webp','image/avif')"
	);

	return array(
		'images'         => $total,
		'images_no_alt'  => $no_alt,
		'modern_formats' => $modern,
	);
}
