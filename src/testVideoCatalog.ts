// Catalogue of freely licensed test videos (#52). The files are not in the repo: the desktop
// app downloads them on request from the official servers, checks size and SHA-256 and keeps
// them in its userData folder (electron/testVideos.cjs). Licences and checksums:
// docs/research/testvideos.md. Checksums were computed on 06.10.2026 from the files then served.

import { num, t } from './i18n';

export interface TestVideo {
  id: string;
  title: string;
  /** version / encode, shown next to the title */
  version: string;
  width: number; height: number; fps: string;
  /** container / codec as probed (ffprobe) or, where marked, as named by the publisher */
  codec: string;
  /** suggested source settings: the files carry no colour tags */
  transfer?: 'pq' | 'hlg'; gamut?: '709' | 'p3' | '2020';
  hdr?: boolean;
  url: string;
  bytes: number;
  sha256: string;
  /** ZIP archive with one entry: the desktop app unpacks it (stored or deflate) and checks the CRC-32 */
  zip?: { name: string; crc32: string; size: number };
  licence: 'CC BY 3.0' | 'CC BY 4.0';
  licenceUrl: string;
  attribution: string;
  /** official page of the title */
  page: string;
  note?: string;
}

const BBB_ATTR = '(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org';
const CC_BY_3 = 'https://creativecommons.org/licenses/by/3.0/';
const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';
const PEACH = 'https://download.blender.org/peach/bigbuckbunny_movies/';
const SUNFLOWER = 'https://download.blender.org/demo/movies/BBB/';
const NETFLIX = 'https://s3.amazonaws.com/download.opencontent.netflix.com/';

const bbb = (id: string, file: string, version: string, width: number, height: number, fps: string, codec: string, bytes: number, sha256: string, zip: TestVideo['zip'], base = PEACH): TestVideo => ({
  id, title: 'Big Buck Bunny', version, width, height, fps, codec, url: base + file, bytes, sha256, zip,
  licence: 'CC BY 3.0', licenceUrl: CC_BY_3, attribution: BBB_ATTR, page: 'https://peach.blender.org/about/',
});

export const TEST_VIDEOS: TestVideo[] = [
  bbb('bbb-180p', 'BigBuckBunny_320x180.mp4.zip', '2008, 320×180', 320, 180, '24', `MP4 H.264 ${t('testmedia.perFileName')}`, 64657225,
    '109e3ede8790bd633f374ca311d9cc61dce8d7f98f5b0797ca98199c9fbceedf', { name: 'BigBuckBunny_320x180.mp4', crc32: '7be7dbc3', size: 64657027 }),
  bbb('bbb-360p', 'BigBuckBunny_640x360.m4v.zip', '2008, 640×360', 640, 359, '24', 'M4V H.264 Constrained Baseline', 121284117,
    '7118242b6728d40c871479c5b3c0f0fb27d748089df15d7f1b469f297c74a2d6', { name: 'BigBuckBunny_640x360.m4v', crc32: '33abb27b', size: 121283919 }),
  bbb('bbb-480p', 'big_buck_bunny_480p_h264.mov.zip', '2008, 480p', 853, 480, '24', 'MOV H.264 Main', 249230089,
    '9735a4124928237f6f011a8a1f492a7c8139d918ddcea86ed0d438406addcbe9', { name: 'big_buck_bunny_480p_h264.mov', crc32: '68930eae', size: 249229883 }),
  bbb('bbb-720p', 'big_buck_bunny_720p_h264.mov.zip', '2008, 720p', 1280, 720, '24', 'MOV H.264 Main, AAC', 416751396,
    'b0c9ade80b086179feee41514929de583966eec87c703575d97f051f88b33b67', { name: 'big_buck_bunny_720p_h264.mov', crc32: '9e371a93', size: 416751190 }),
  bbb('bbb-1080p', 'big_buck_bunny_1080p_h264.mov.zip', '2008, 1080p', 1920, 1080, '24', 'MOV H.264 Main', 725106348,
    '402d6625f614631627d518b931865c9c4aefbbf3b75ed0494672e77ff510666d', { name: 'big_buck_bunny_1080p_h264.mov', crc32: '342ab687', size: 725106140 }),
  bbb('bbb-sun-1080p30', 'bbb_sunflower_1080p_30fps_normal.mp4.zip', t('testmedia.rerendered', { fmt: '1080p30' }), 1920, 1080, '30', 'MP4 H.264 High L4.1', 275524128,
    'e320fef389ec749117d0c1583945039266a40f25483881c2ff0d33207e62b362', { name: 'bbb_sunflower_1080p_30fps_normal.mp4', crc32: '1430636f', size: 276134947 }, SUNFLOWER),
  bbb('bbb-sun-1080p60', 'bbb_sunflower_1080p_60fps_normal.mp4.zip', t('testmedia.rerendered', { fmt: '1080p60' }), 1920, 1080, '60', `MP4 H.264 ${t('testmedia.perFileName')}`, 355019001,
    '68c456673409f8df09b80d0afe29ecb38ef110551fa8a93c83e54a96ebdaec78', { name: 'bbb_sunflower_1080p_60fps_normal.mp4', crc32: '9175c586', size: 355856562 }, SUNFLOWER),
  bbb('bbb-sun-2160p30', 'bbb_sunflower_2160p_30fps_normal.mp4.zip', t('testmedia.rerendered', { fmt: '2160p30' }), 3840, 2160, '30', `MP4 H.264 ${t('testmedia.perFileName')}`, 632204510,
    '750b255c6d9fee1e2a03a6716d4f358bca56e9115bf3e06a66162fc5272ae151', { name: 'bbb_sunflower_2160p_30fps_normal.mp4', crc32: 'b33293e8', size: 633016449 }, SUNFLOWER),
  bbb('bbb-sun-2160p60', 'bbb_sunflower_2160p_60fps_normal.mp4.zip', t('testmedia.rerendered', { fmt: '2160p60' }), 3840, 2160, '60', 'MP4 H.264 High L5.1, MP3 + AC-3', 671868845,
    '061ac3cd5519ed39fb610287632e4fea6c42270ecd53413d3491b8d753ae2bf3', { name: 'bbb_sunflower_2160p_60fps_normal.mp4', crc32: '5dfbc8dd', size: 673223862 }, SUNFLOWER),
  {
    id: 'cosmos-hdr', title: 'Cosmos Laundromat', version: 'HDR P3/PQ, 2K 24p', width: 2048, height: 858, fps: num(23.976, 3), codec: 'MP4 H.264 High, 8 bit 4:2:0',
    transfer: 'pq', gamut: 'p3', hdr: true,
    url: `${NETFLIX}CosmosLaundromat/CosmosLaundromat_2k24p_HDR_P3PQ.mp4`, bytes: 729482878,
    sha256: '4762d0d77ce6c09371032e0c6b4dbda8ad781237b5264829857eefeed7a3b40a',
    licence: 'CC BY 4.0', licenceUrl: CC_BY_4,
    attribution: t('testmedia.cosmosAttr'),
    page: 'https://opencontent.netflix.com/',
    note: t('testmedia.cosmosNote'),
  },
  {
    id: 'meridian-hdr', title: 'Meridian', version: `HDR P3/PQ, UHD ${num(59.94, 2)}p`, width: 3840, height: 2160, fps: num(59.94, 2), codec: 'MP4 H.264 High, 8 bit 4:2:0',
    transfer: 'pq', gamut: 'p3', hdr: true,
    url: `${NETFLIX}Meridian/Meridian_UHD4k5994_HDR_P3PQ.mp4`, bytes: 850587087,
    sha256: 'e14ff5ab8ce4cc90269e8ed45babcf6e25d7a073b71438b3e7ffee5901a7177e',
    licence: 'CC BY 4.0', licenceUrl: CC_BY_4,
    attribution: 'Meridian – Netflix, Inc.; Netflix Open Content, CC BY 4.0',
    page: 'https://opencontent.netflix.com/',
    note: t('testmedia.meridianNote'),
  },
];

export const videoById = (id: string) => TEST_VIDEOS.find((v) => v.id === id);

/** Hosts the desktop app downloads from (electron/testVideos.cjs checks the same list). */
export const ALLOWED_PREFIXES = [PEACH, SUNFLOWER, NETFLIX];

export const formatBytes = (n: number) => (n >= 1e9 ? `${num(n / 1e9, 2)} GB` : `${Math.round(n / 1e6)} MB`);
