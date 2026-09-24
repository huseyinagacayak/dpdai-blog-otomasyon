<?php
/**
 * Panel uzerinden otomatik guncelleme.
 *
 * Eklenti WordPress.org'da olmadigi icin guncelleme bildirimini panelden alir.
 * Panel adresi ilk basarili istekte kendiliginden kaydedilir (panel her
 * cagriya X-DPDAI-Panel basligi ekler); istenirse Araclar ekranindan elle
 * de girilebilir.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const DPDAI_PANEL_OPTION     = 'dpdai_panel_url';
const DPDAI_UPDATE_TRANSIENT = 'dpdai_update_info';

/** Kayitli panel adresi (sonda bolu isareti olmadan). */
function dpdai_panel_url() {
	return untrailingslashit( (string) get_option( DPDAI_PANEL_OPTION, '' ) );
}

/**
 * Panel her REST cagrisina kendi adresini ekler; ilk istekte kaydedilir.
 * Boylece kullanicinin elle adres girmesine gerek kalmaz.
 */
add_filter( 'rest_pre_dispatch', 'dpdai_capture_panel_url', 10, 3 );
function dpdai_capture_panel_url( $result, $server, $request ) {
	if ( strpos( (string) $request->get_route(), '/dpdai/v1' ) !== 0 ) {
		return $result;
	}

	$sent = esc_url_raw( (string) $request->get_header( 'x-dpdai-panel' ) );
	if ( $sent && $sent !== dpdai_panel_url() ) {
		update_option( DPDAI_PANEL_OPTION, untrailingslashit( $sent ), false );
		delete_transient( DPDAI_UPDATE_TRANSIENT );
	}

	return $result;
}

/**
 * Panelden surum bilgisini ceker. Sonuc 6 saat onbelleklenir; panel
 * kapaliysa site yavaslamasin diye kisa zaman asimi kullanilir.
 */
function dpdai_fetch_update_info( $force = false ) {
	if ( ! $force ) {
		$cached = get_transient( DPDAI_UPDATE_TRANSIENT );
		if ( $cached !== false ) {
			return is_array( $cached ) ? $cached : null;
		}
	}

	$panel = dpdai_panel_url();
	if ( ! $panel ) {
		return null;
	}

	$res = wp_remote_get(
		$panel . '/api/plugin/manifest',
		array(
			'timeout' => 8,
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);

	if ( is_wp_error( $res ) || wp_remote_retrieve_response_code( $res ) !== 200 ) {
		// Basarisiz denemeyi de kisa sure onbellekle: her sayfa yuklemede denemesin
		set_transient( DPDAI_UPDATE_TRANSIENT, array(), 30 * MINUTE_IN_SECONDS );
		return null;
	}

	$info = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( ! is_array( $info ) || empty( $info['version'] ) ) {
		set_transient( DPDAI_UPDATE_TRANSIENT, array(), 30 * MINUTE_IN_SECONDS );
		return null;
	}

	set_transient( DPDAI_UPDATE_TRANSIENT, $info, 6 * HOUR_IN_SECONDS );
	return $info;
}

/** Eklentiler ekranindaki guncelleme rozetini besler. */
add_filter( 'pre_set_site_transient_update_plugins', 'dpdai_inject_update' );
function dpdai_inject_update( $transient ) {
	if ( ! is_object( $transient ) ) {
		return $transient;
	}

	$info = dpdai_fetch_update_info();
	if ( ! $info || empty( $info['version'] ) ) {
		return $transient;
	}

	$basename = plugin_basename( DPDAI_PLUGIN_FILE );

	if ( version_compare( $info['version'], DPDAI_BRIDGE_VERSION, '>' ) ) {
		$transient->response[ $basename ] = (object) array(
			'slug'         => 'dpdai-bridge',
			'plugin'       => $basename,
			'new_version'  => $info['version'],
			'url'          => $info['homepage'] ?? '',
			'package'      => $info['download_url'] ?? '',
			'requires'     => $info['requires'] ?? '',
			'requires_php' => $info['requires_php'] ?? '',
			'tested'       => $info['tested'] ?? '',
		);
	} else {
		$transient->no_update[ $basename ] = (object) array(
			'slug'        => 'dpdai-bridge',
			'plugin'      => $basename,
			'new_version' => DPDAI_BRIDGE_VERSION,
			'package'     => '',
		);
	}

	return $transient;
}

/** "Ayrıntıları görüntüle" penceresi. */
add_filter( 'plugins_api', 'dpdai_plugin_details', 20, 3 );
function dpdai_plugin_details( $result, $action, $args ) {
	if ( $action !== 'plugin_information' || empty( $args->slug ) || $args->slug !== 'dpdai-bridge' ) {
		return $result;
	}

	$info = dpdai_fetch_update_info();
	if ( ! $info ) {
		return $result;
	}

	return (object) array(
		'name'          => $info['name'] ?? 'DPDAI Bridge',
		'slug'          => 'dpdai-bridge',
		'version'       => $info['version'],
		'author'        => $info['author'] ?? 'DPDAI',
		'homepage'      => $info['homepage'] ?? '',
		'requires'      => $info['requires'] ?? '',
		'requires_php'  => $info['requires_php'] ?? '',
		'tested'        => $info['tested'] ?? '',
		'last_updated'  => $info['last_updated'] ?? '',
		'download_link' => $info['download_url'] ?? '',
		'sections'      => (array) ( $info['sections'] ?? array() ),
	);
}

/**
 * Guncelleme sonrasi klasor adini koru.
 * Zip "dpdai-bridge/" ile aciliyor, yine de garanti altina aliyoruz.
 */
add_filter( 'upgrader_source_selection', 'dpdai_fix_source_dir', 10, 4 );
function dpdai_fix_source_dir( $source, $remote_source, $upgrader, $args = array() ) {
	if ( empty( $args['plugin'] ) || $args['plugin'] !== plugin_basename( DPDAI_PLUGIN_FILE ) ) {
		return $source;
	}

	$hedef = trailingslashit( $remote_source ) . 'dpdai-bridge/';
	if ( $source === $hedef ) {
		return $source;
	}

	global $wp_filesystem;
	if ( $wp_filesystem && $wp_filesystem->move( $source, $hedef ) ) {
		return $hedef;
	}

	return $source;
}

/** Guncelleme kontrolunu elle tetikle. */
function dpdai_force_update_check() {
	delete_transient( DPDAI_UPDATE_TRANSIENT );
	delete_site_transient( 'update_plugins' );
	return dpdai_fetch_update_info( true );
}
