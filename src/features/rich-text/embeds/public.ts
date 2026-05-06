/**
 * Superficie pública del sub-slice `rich-text/embeds`.
 *
 * Re-exporta los 4 plugins + nodes para que los composers de surface
 * (post + library-item) los registren condicionalmente según
 * `Place.editorPluginsConfig` (F.5). Cada provider vive en su propia
 * carpeta — el sub-slice agrupa la pieza "embeds" para no superar el
 * cap 1500 LOC del slice padre.
 *
 * Patrón heredado de `discussions/flags/` (ADR
 * `2026-04-21-flags-subslice-split.md`). El slice principal NO re-exporta
 * estos símbolos: los consumers que activan embeds importan directo de
 * `@/features/rich-text/embeds/public`.
 */

// YouTube
export {
  YouTubeNode,
  $createYouTubeNode,
  $isYouTubeNode,
  type YouTubePayload,
} from './youtube/embed-node'
export { YouTubePlugin, tryInsertYouTubeFromUrl } from './youtube/embed-plugin'
export { parseYoutubeUrl, type ParsedYoutube } from './youtube/parse-url'

// Spotify
export {
  SpotifyNode,
  $createSpotifyNode,
  $isSpotifyNode,
  type SpotifyKind,
  type SpotifyPayload,
} from './spotify/embed-node'
export { SpotifyPlugin, tryInsertSpotifyFromUrl } from './spotify/embed-plugin'
export { parseSpotifyUrl, type ParsedSpotify } from './spotify/parse-url'

// Apple Podcasts
export {
  ApplePodcastNode,
  $createApplePodcastNode,
  $isApplePodcastNode,
  type ApplePodcastPayload,
} from './apple-podcast/embed-node'
export { ApplePodcastPlugin, tryInsertApplePodcastFromUrl } from './apple-podcast/embed-plugin'
export { parseApplePodcastUrl, type ParsedApplePodcast } from './apple-podcast/parse-url'

// Ivoox
export { IvooxNode, $createIvooxNode, $isIvooxNode, type IvooxPayload } from './ivoox/embed-node'
export { IvooxPlugin, tryInsertIvooxFromUrl } from './ivoox/embed-plugin'
export { parseIvooxUrl, type ParsedIvoox } from './ivoox/parse-url'
