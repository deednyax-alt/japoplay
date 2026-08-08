const path = require('path');

const API_KEY = 'ff_ea4e1e98f822dddd9fee397f6ab9d4e55f49caf8e3f18e2f211e907a97123bb0';

const DIRECT_CHANNELS = [
  { id: 'tf1-fhd-b', name: 'TF1 HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/TF1_logo_2013.svg/960px-TF1_logo_2013.svg.png', slug: 'tf1-fhd-b' },
  { id: 'france-2-hd-b', name: 'FRANCE 2 HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/France_2_2018.svg/960px-France_2_2018.svg.png', slug: 'france-2-hd-b' },
  { id: 'france-3-fhd-b', name: 'FRANCE 3 HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/France_3_2018.svg/960px-France_3_2018.svg.png', slug: 'france-3-fhd-b' },
  { id: 'canal-plus-hd-b', name: 'CANAL+ HD', category: 'Canal+ & Cinéma', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Canal%2B_2013.svg/960px-Canal%2B_2013.svg.png', slug: 'canal-plus-hd-b' },
  { id: 'france-5-hd-b', name: 'FRANCE 5 HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/France_5_2018.svg/960px-France_5_2018.svg.png', slug: 'france-5-hd-b' },
  { id: 'm6-fhd-b', name: 'M6 HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/M6_logo_2009.svg/960px-M6_logo_2009.svg.png', slug: 'm6-fhd-b' },
  { id: 'arte-hd-b', name: 'ARTE HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Arte_Logo.svg/960px-Arte_Logo.svg.png', slug: 'arte-hd-b' },
  { id: 'c8-fhd-b', name: 'C8 HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/C8_logo_2016.svg/960px-C8_logo_2016.svg.png', slug: 'c8-fhd-b' },
  { id: 'w9-fhd-b', name: 'W9 HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/W9_logo_2018.svg/960px-W9_logo_2018.svg.png', slug: 'w9-fhd-b' },
  { id: 'tmc-fhd-b', name: 'TMC HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/TMC_2016.svg/960px-TMC_2016.svg.png', slug: 'tmc-fhd-b' },
  { id: 'tfx-fhd-b', name: 'TFX HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/TFX_logo_2018.svg/960px-TFX_logo_2018.svg.png', slug: 'tfx-fhd-b' },
  { id: 'nrj-12-fhd-b', name: 'NRJ 12 HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/NRJ12_logo_2015.svg/960px-NRJ12_logo_2015.svg.png', slug: 'nrj-12-fhd-b' },
  { id: 'lcp-hd-b', name: 'LCP HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/LCP_logo_2019.svg/960px-LCP_logo_2019.svg.png', slug: 'lcp-hd-b' },
  { id: 'france-4-hd-b', name: 'FRANCE 4 HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/France_4_2018.svg/960px-France_4_2018.svg.png', slug: 'france-4-hd-b' },
  { id: 'bfm-tv-hd-b', name: 'BFM TV HD', category: 'Information', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e2/BFMTV_logo_2019.svg/960px-BFMTV_logo_2019.svg.png', slug: 'bfm-tv-hd-b' },
  { id: 'cnews-fhd-b', name: 'CNEWS HD', category: 'Information', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/CNEWS_logo_2017.svg/960px-CNEWS_logo_2017.svg.png', slug: 'cnews-fhd-b' },
  { id: 'cstar-fhd-b', name: 'CSTAR HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/CStar_logo_2016.svg/960px-CStar_logo_2016.svg.png', slug: 'cstar-fhd-b' },
  { id: 'gulli-fhd-b', name: 'GULLI HD', category: 'Jeunesse', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Gulli_logo_2017.svg/960px-Gulli_logo_2017.svg.png', slug: 'gulli-fhd-b' },
  { id: 'l-equipe-21-fhd-b', name: 'L\'ÉQUIPE HD', category: 'Sports', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/L%27%C3%89quipe_21_logo.svg/960px-L%27%C3%89quipe_21_logo.svg.png', slug: 'l-equipe-21-fhd-b' },
  { id: '6ter-fhd-b', name: '6TER HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/6ter_logo_2012.svg/960px-6ter_logo_2012.svg.png', slug: '6ter-fhd-b' },
  { id: 'rmc-story-fhd-b', name: 'RMC STORY HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/RMC_Story_logo_2018.svg/960px-RMC_Story_logo_2018.svg.png', slug: 'rmc-story-fhd-b' },
  { id: 'rmc-decouverte-fhd-b', name: 'RMC DÉCOUVERTE HD', category: 'Documentaires', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/RMC_D%C3%A9couverte_logo_2017.svg/960px-RMC_D%C3%A9couverte_logo_2017.svg.png', slug: 'rmc-decouverte-fhd-b' },
  { id: 'cherie-25-fhd-b', name: 'CHÉRIE 25 HD', category: 'TNT France', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Ch%C3%A9rie_25_logo_2015.svg/960px-Ch%C3%A9rie_25_logo_2015.svg.png', slug: 'cherie-25-fhd-b' },
  { id: 'lci-fhd-b', name: 'LCI HD', category: 'Information', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/LCI_logo_2017.svg/960px-LCI_logo_2017.svg.png', slug: 'lci-fhd-b' },
  { id: 'franceinfo-hd-b', name: 'FRANCEINFO: HD', category: 'Information', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Franceinfo_logo_2016.svg/960px-Franceinfo_logo_2016.svg.png', slug: 'franceinfo-hd-b' },
  { id: 'bein-sports-1-hd-b', name: 'BEIN SPORTS 1 HD', category: 'Sports', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/BeIN_Sports_1_logo_2017.svg/960px-BeIN_Sports_1_logo_2017.svg.png', slug: 'bein-sports-1-hd-b' },
  { id: 'bein-sports-2-hd-b', name: 'BEIN SPORTS 2 HD', category: 'Sports', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/BeIN_Sports_2_logo_2017.svg/960px-BeIN_Sports_2_logo_2017.svg.png', slug: 'bein-sports-2-hd-b' },
  { id: 'bein-sports-3-hd-b', name: 'BEIN SPORTS 3 HD', category: 'Sports', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/BeIN_Sports_3_logo_2017.svg/960px-BeIN_Sports_3_logo_2017.svg.png', slug: 'bein-sports-3-hd-b' },
  { id: 'canal-plus-sport-hd-b', name: 'CANAL+ SPORT HD', category: 'Sports', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/Canal%2B_Sport_2013.svg/960px-Canal%2B_Sport_2013.svg.png', slug: 'canal-plus-sport-hd-b' },
  { id: 'eurosport-1-hd-b', name: 'EUROSPORT 1 HD', category: 'Sports', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Eurosport_1_logo_2015.svg/960px-Eurosport_1_logo_2015.svg.png', slug: 'eurosport-1-hd-b' },
  { id: 'eurosport-2-hd-b', name: 'EUROSPORT 2 HD', category: 'Sports', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Eurosport_2_logo_2015.svg/960px-Eurosport_2_logo_2015.svg.png', slug: 'eurosport-2-hd-b' }
];

async function getChannels() {
  return DIRECT_CHANNELS.map(c => ({
    ...c,
    streamUrl: `https://northlive.lol/api/v1/index.php?route=tv/${c.slug}/player&api_key=${API_KEY}`
  }));
}

module.exports = {
  getChannels
};
