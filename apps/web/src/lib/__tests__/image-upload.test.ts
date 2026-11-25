import { describe, expect, it } from 'vitest';
import { asJpgName, fitSize, isHeic, uploadAccept } from '../image-upload';

// image-upload (owner 2026-11-25: "images are not getting uploaded").
describe('image upload', () => {
  it('computers accept iPhone HEIC photos again; iPhone / iPad leave it out so iOS sends JPEG', () => {
    expect(uploadAccept(false)).toContain('.heic');
    expect(uploadAccept(false)).toContain('.jpg');
    expect(uploadAccept(true)).not.toContain('.heic');
    expect(uploadAccept(true)).toContain('.png');
  });
  it('spots HEIC by type or name', () => {
    expect(isHeic({ name: 'IMG_1.HEIC', type: '' })).toBe(true);
    expect(isHeic({ name: 'x', type: 'image/heif' })).toBe(true);
    expect(isHeic({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false);
  });
  it('scales a big photo to 3000 px on the long side, keeps small ones', () => {
    expect(fitSize(8064, 6048)).toEqual([3000, 2250]);
    expect(fitSize(6048, 8064)).toEqual([2250, 3000]);
    expect(fitSize(1200, 800)).toEqual([1200, 800]);
  });
  it('names the converted photo .jpg', () => {
    expect(asJpgName('IMG_0042.HEIC')).toBe('IMG_0042.jpg');
    expect(asJpgName('scan.png')).toBe('scan.jpg');
  });
});
