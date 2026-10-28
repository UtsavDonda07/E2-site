// Sprite overrides: a building listed here is drawn from its picture instead of the built-in drawing.
// These pictures are rendered from Kenney's CC0 3D kits with tools/render-models.html (see art/LICENSE-Kenney-CC0.txt).
//   src    picture file         ax, ay  the point of the picture (0..1) that sits on the middle of the building's ground
//   scale  0.5 = the pictures were rendered at 2x for sharpness      h  height above the ground in pixels (for taps and labels)
window.E2_SPRITES = {
  hq:          { src: 'art/rendered/hq.png',          ax: 0.5, ay: 0.7554, scale: 0.5, h: 140 },
  oilRefinery: { src: 'art/rendered/oilRefinery.png', ax: 0.5, ay: 0.6839, scale: 0.5, h: 66 },
  steelMill:   { src: 'art/rendered/steelMill.png',   ax: 0.5, ay: 0.7332, scale: 0.5, h: 88 },
  vault:       { src: 'art/rendered/vault.png',       ax: 0.5, ay: 0.6787, scale: 0.5, h: 62 },
  barracks:    { src: 'art/rendered/barracks.png',    ax: 0.5, ay: 0.676,  scale: 0.5, h: 62 },
  researchLab: { src: 'art/rendered/researchLab.png', ax: 0.5, ay: 0.7106, scale: 0.5, h: 78 },
  harbor:      { src: 'art/rendered/harbor.png',      ax: 0.5, ay: 0.6024, scale: 0.5, h: 42 },
  // The country, composed from Kenney's CC0 "Isometric Buildings" tiles with tools/make_town_sprites.py.
  house:   { src: 'art/town/house.png',   ax: 0.5, ay: 0.7253, scale: 0.64, h: 58 },
  village: { src: 'art/town/village.png', ax: 0.5, ay: 0.5935, scale: 0.64, h: 79 },
  city:    { src: 'art/town/city.png',    ax: 0.5, ay: 0.6231, scale: 0.64, h: 127 },
  farm:    { src: 'art/town/farm.png',    ax: 0.5, ay: 0.5197, scale: 0.64, h: 81 },
};
