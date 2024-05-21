export const pngs = [
  {
    width: 2,
    height: 2,
    depth: 8,
    channels: 3,
    data: new Uint8Array([
      0xff,0xff,0xff,
      0xff,0x00,0x00,
      0x00,0xff,0x00,
      0x00,0x00,0xff
    ])
  },
  {
    width: 1,
    height: 3,
    depth: 8,
    channels: 3,
    data: new Uint8Array([
      0xff,0x00,0x00,
      0x00,0xff,0x00,
      0x00,0x00,0xff
    ])
  },
  {
    width: 3,
    height: 1,
    depth: 8,
    channels: 4,
    data: new Uint8Array([
      0xff,0x00,0x00,0xff,
      0x00,0xff,0x00,0xff,
      0x00,0x00,0xff,0xff
    ])
  },
  {
    width: 1,
    height: 3,
    depth: 16,
    channels: 3,
    data: new Uint16Array([
      ...floatsToUint16([ 1, 0, 0 ]),
      ...floatsToUint16([ 0, 1, 0 ]),
      ...floatsToUint16([ 0, 0, 1 ])
    ])
  },
  {
    width: 2,
    height: 2,
    depth: 16,
    channels: 4,
    data: new Uint16Array([
      ...floatsToUint16([ 1, 0, 0, 1 ]),
      ...floatsToUint16([ 0, 1, 0, 0.5 ]),
      ...floatsToUint16([ 0, 0, 1, 0.25 ]),
      ...floatsToUint16([ 0, 0, 0, 0 ])
    ])
  }
]

function floatsToUint16 (rgb) {
  return rgb.map(r => Math.max(0, Math.min(0xffff, Math.round(r * 0xffff))))
}
