declare module 'piexifjs' {
  export interface ExifDict {
    '0th'?: Record<number, unknown>;
    Exif?: Record<number, unknown>;
    GPS?: Record<number, unknown>;
    Interop?: Record<number, unknown>;
    '1st'?: Record<number, unknown>;
    thumbnail?: string | null;
  }

  const piexif: {
    load: (data: string) => ExifDict;
    dump: (exifDict: ExifDict) => string;
    insert: (exifBytes: string, jpeg: string) => string;
    remove: (jpeg: string) => string;
    ImageIFD: { Orientation: number };
  };

  export default piexif;
}
