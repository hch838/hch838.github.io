"""从 APK 的二进制 AndroidManifest.xml (AXML) 中提取 versionName。

只依赖标准库。用法：
    python3 scripts/axml.py path/to/file.apk
成功时向 stdout 输出清理过的版本号（可能为空行），失败时不输出并返回非零。
"""
import re
import struct
import sys
import zipfile

TYPE_STRING_POOL = 0x0001
TYPE_START_ELEMENT = 0x0102


def parse_string_pool(data, off):
    _typ, hsize, _csize = struct.unpack_from('<HHI', data, off)
    count, _style_count, flags, strings_start, _styles_start = struct.unpack_from(
        '<IIIII', data, off + 8)
    utf8 = bool(flags & 0x100)
    offsets = struct.unpack_from('<%dI' % count, data, off + hsize)
    base = off + strings_start

    out = []
    for rel in offsets:
        p = base + rel
        if utf8:
            n1 = data[p]
            p += 1
            if n1 & 0x80:
                n1 = ((n1 & 0x7F) << 8) | data[p]
                p += 1
            n2 = data[p]
            p += 1
            if n2 & 0x80:
                n2 = ((n2 & 0x7F) << 8) | data[p]
                p += 1
            out.append(data[p:p + n2].decode('utf-8', 'replace'))
        else:
            n = struct.unpack_from('<H', data, p)[0]
            p += 2
            if n & 0x8000:
                n2 = struct.unpack_from('<H', data, p)[0]
                p += 2
                n = ((n & 0x7FFF) << 16) | n2
            out.append(data[p:p + n * 2].decode('utf-16-le', 'replace'))
    return out


def read_version_name(apk_path):
    with zipfile.ZipFile(apk_path) as z:
        data = z.read('AndroidManifest.xml')

    if len(data) < 8 or struct.unpack_from('<H', data, 0)[0] != 0x0003:
        raise ValueError('not axml')

    strings = []
    off = 8
    while off + 8 <= len(data):
        typ, _hsize, csize = struct.unpack_from('<HHI', data, off)
        if csize < 8:
            break

        if typ == TYPE_STRING_POOL:
            strings = parse_string_pool(data, off)

        elif typ == TYPE_START_ELEMENT:
            _ns_i, name_i = struct.unpack_from('<II', data, off + 16)
            attr_start, attr_size, attr_count = struct.unpack_from('<HHH', data, off + 24)
            el_name = strings[name_i] if name_i < len(strings) else ''

            if el_name == 'manifest':
                p0 = off + 16 + attr_start
                for i in range(attr_count):
                    p = p0 + i * attr_size
                    if p + 20 > len(data):
                        break
                    _a_ns, a_name, a_raw = struct.unpack_from('<III', data, p)
                    a_type = data[p + 15]
                    a_data = struct.unpack_from('<I', data, p + 16)[0]
                    attr = strings[a_name] if a_name < len(strings) else ''

                    if attr != 'versionName':
                        continue
                    if a_raw != 0xFFFFFFFF and a_raw < len(strings):
                        return strings[a_raw]
                    if a_type == 0x03 and a_data < len(strings):
                        return strings[a_data]
                return None

        off += csize

    return None


def main():
    if len(sys.argv) < 2:
        return 2
    try:
        raw = read_version_name(sys.argv[1])
    except Exception:
        return 1
    if not raw:
        return 1
    safe = re.sub(r'[^A-Za-z0-9._-]', '', raw.strip())
    if not safe:
        return 1
    sys.stdout.write(safe)
    return 0


if __name__ == '__main__':
    sys.exit(main())
