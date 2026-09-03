//! Minimal JCE/Tars binary codec — just what Huya's WUP RPC and danmaku
//! websocket protocols need.
//!
//! Why hand-rolled: the only crates.io option (`tars-stream 0.1.1`, 2018)
//! uses `#![feature(try_from)]` and does not compile on stable Rust. The
//! codec surface we need is small: ints, strings, bytes (simple_list),
//! string lists, string→bytes maps (UniAttribute), struct markers.
//!
//! Wire format:
//!   head = 1 byte: high nibble = tag, low nibble = type
//!   (tag >= 15 → first byte 0xF0|type, second byte = tag)
//!   types: 0=i8 1=i16(BE) 2=i32(BE) 3=i64(BE) 4=f32 5=f64
//!          6=string1(u8 len) 7=string4(u32 BE len)
//!          8=map 9=list 10=struct_begin 11=struct_end 12=zero(=0)
//!          13=simple_list(bytes): head(13,tag) + head(0,0) + int32 len + raw
//!   map:    head(8,tag) + int32(tag 0)=size + size×(key@tag0, value@tag1)
//!   list:   head(9,tag) + int32(tag 0)=size + elements@tag0
//!   struct: head(10,tag) + fields + head(11,0)
//!
//! Integers shrink to the smallest width that fits (canonical JCE); the
//! decoder reads whatever width the head declares.

const TYPE_BYTE: u8 = 0;
const TYPE_SHORT: u8 = 1;
const TYPE_INT: u8 = 2;
const TYPE_LONG: u8 = 3;
const TYPE_FLOAT: u8 = 4;
const TYPE_DOUBLE: u8 = 5;
const TYPE_STRING1: u8 = 6;
const TYPE_STRING4: u8 = 7;
const TYPE_MAP: u8 = 8;
const TYPE_LIST: u8 = 9;
const TYPE_STRUCT_BEGIN: u8 = 10;
const TYPE_STRUCT_END: u8 = 11;
const TYPE_ZERO: u8 = 12;
const TYPE_SIMPLE_LIST: u8 = 13;

// ── Encoder ─────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct JceEncoder {
    buf: Vec<u8>,
}

impl JceEncoder {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        self.buf.clone()
    }

    fn write_head(&mut self, ty: u8, tag: u8) {
        if tag < 15 {
            self.buf.push((tag << 4) | ty);
        } else {
            self.buf.push(0xF0 | ty);
            self.buf.push(tag);
        }
    }

    pub fn write_int8(&mut self, tag: u8, v: i8) {
        if v == 0 {
            self.write_head(TYPE_ZERO, tag);
            return;
        }
        self.write_head(TYPE_BYTE, tag);
        self.buf.push(v as u8);
    }

    pub fn write_int16(&mut self, tag: u8, v: i16) {
        if let Ok(b) = i8::try_from(v) {
            self.write_int8(tag, b);
            return;
        }
        self.write_head(TYPE_SHORT, tag);
        self.buf.extend_from_slice(&v.to_be_bytes());
    }

    pub fn write_int32(&mut self, tag: u8, v: i32) {
        if let Ok(s) = i16::try_from(v) {
            self.write_int16(tag, s);
            return;
        }
        self.write_head(TYPE_INT, tag);
        self.buf.extend_from_slice(&v.to_be_bytes());
    }

    pub fn write_int64(&mut self, tag: u8, v: i64) {
        if let Ok(i) = i32::try_from(v) {
            self.write_int32(tag, i);
            return;
        }
        self.write_head(TYPE_LONG, tag);
        self.buf.extend_from_slice(&v.to_be_bytes());
    }

    pub fn write_string(&mut self, tag: u8, v: &str) {
        let bytes = v.as_bytes();
        if bytes.len() < 256 {
            self.write_head(TYPE_STRING1, tag);
            self.buf.push(bytes.len() as u8);
        } else {
            self.write_head(TYPE_STRING4, tag);
            self.buf.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        }
        self.buf.extend_from_slice(bytes);
    }

    /// simple_list of bytes: head(13, tag) + head(byte, 0) + int32 len + raw
    pub fn write_bytes(&mut self, tag: u8, v: &[u8]) {
        self.write_head(TYPE_SIMPLE_LIST, tag);
        self.write_head(TYPE_BYTE, 0);
        self.write_int32(0, v.len() as i32);
        self.buf.extend_from_slice(v);
    }

    /// list<string>
    #[allow(dead_code)] // consumed by the huya danmaku client
    pub fn write_string_list(&mut self, tag: u8, items: &[String]) {
        self.write_head(TYPE_LIST, tag);
        self.write_int32(0, items.len() as i32);
        for item in items {
            self.write_string(0, item);
        }
    }

    /// map<string, bytes> — JCE UniAttribute shape.
    pub fn write_map_string_bytes(&mut self, tag: u8, map: &[(String, Vec<u8>)]) {
        self.write_head(TYPE_MAP, tag);
        self.write_int32(0, map.len() as i32);
        for (k, v) in map {
            self.write_string(0, k);
            self.write_bytes(1, v);
        }
    }

    pub fn write_empty_map(&mut self, tag: u8) {
        self.write_head(TYPE_MAP, tag);
        self.write_int32(0, 0);
    }

    /// Embed an already-encoded struct body as a struct field.
    pub fn write_struct_raw(&mut self, tag: u8, body: &[u8]) {
        self.write_head(TYPE_STRUCT_BEGIN, tag);
        self.buf.extend_from_slice(body);
        self.write_head(TYPE_STRUCT_END, 0);
    }
}

// ── Decoder ─────────────────────────────────────────────────────────────────

pub struct JceDecoder<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> JceDecoder<'a> {
    pub fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    fn read_head(&mut self) -> Result<(u8, u8), String> {
        let b = *self
            .buf
            .get(self.pos)
            .ok_or_else(|| "jce: unexpected end reading head".to_string())?;
        self.pos += 1;
        let ty = b & 0x0F;
        let mut tag = (b & 0xF0) >> 4;
        if tag == 15 {
            tag = *self
                .buf
                .get(self.pos)
                .ok_or_else(|| "jce: unexpected end reading extended tag".to_string())?;
            self.pos += 1;
        }
        Ok((ty, tag))
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.pos + n > self.buf.len() {
            return Err("jce: unexpected end reading payload".to_string());
        }
        let s = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }

    fn read_i64_payload(&mut self, ty: u8) -> Result<i64, String> {
        match ty {
            TYPE_ZERO => Ok(0),
            TYPE_BYTE => Ok(self.take(1)?[0] as i8 as i64),
            TYPE_SHORT => Ok(i16::from_be_bytes(self.take(2)?.try_into().unwrap()) as i64),
            TYPE_INT => Ok(i32::from_be_bytes(self.take(4)?.try_into().unwrap()) as i64),
            TYPE_LONG => Ok(i64::from_be_bytes(self.take(8)?.try_into().unwrap())),
            _ => Err(format!("jce: type {ty} is not an integer")),
        }
    }

    /// Advance to the field with `tag`, consuming nothing past its head.
    /// Returns the field's type, or None if the struct ran out before it
    /// (JCE writes fields in ascending tag order, so a larger tag or a
    /// struct-end marker means "absent").
    fn seek_tag(&mut self, tag: u8) -> Result<Option<u8>, String> {
        loop {
            if self.pos >= self.buf.len() {
                return Ok(None); // buffer exhausted — field absent
            }
            let save = self.pos;
            let (ty, found) = self.read_head()?;
            if ty == TYPE_STRUCT_END {
                self.pos = save; // leave the end marker for read_struct_end
                return Ok(None);
            }
            if found == tag {
                return Ok(Some(ty));
            }
            if found > tag {
                self.pos = save; // rewind — the field is absent
                return Ok(None);
            }
            self.skip_field(ty)?;
        }
    }

    fn skip_field(&mut self, ty: u8) -> Result<(), String> {
        match ty {
            TYPE_BYTE => {
                self.take(1)?;
            }
            TYPE_SHORT => {
                self.take(2)?;
            }
            TYPE_INT | TYPE_FLOAT => {
                self.take(4)?;
            }
            TYPE_LONG | TYPE_DOUBLE => {
                self.take(8)?;
            }
            TYPE_STRING1 => {
                let len = self.take(1)?[0] as usize;
                self.take(len)?;
            }
            TYPE_STRING4 => {
                let len = u32::from_be_bytes(self.take(4)?.try_into().unwrap()) as usize;
                self.take(len)?;
            }
            TYPE_ZERO => {}
            TYPE_SIMPLE_LIST => {
                let (elem_ty, _) = self.read_head()?;
                if elem_ty != TYPE_BYTE {
                    return Err(format!("jce: simple_list elem type {elem_ty} != byte"));
                }
                let len = self.read_len()?;
                self.take(len)?;
            }
            TYPE_LIST => {
                let len = self.read_len()?;
                for _ in 0..len {
                    let (ety, _) = self.read_head()?;
                    self.skip_field(ety)?;
                }
            }
            TYPE_MAP => {
                let len = self.read_len()?;
                for _ in 0..len * 2 {
                    let (ety, _) = self.read_head()?;
                    self.skip_field(ety)?;
                }
            }
            TYPE_STRUCT_BEGIN => {
                loop {
                    let (ety, _) = self.read_head()?;
                    if ety == TYPE_STRUCT_END {
                        break;
                    }
                    self.skip_field(ety)?;
                }
            }
            TYPE_STRUCT_END => return Err("jce: stray struct end".to_string()),
            _ => return Err(format!("jce: unknown type {ty}")),
        }
        Ok(())
    }

    /// Read the mandatory int32 "size" that prefixes list/map/simple_list.
    fn read_len(&mut self) -> Result<usize, String> {
        let (ty, _) = self.read_head()?;
        let n = self.read_i64_payload(ty)?;
        if n < 0 {
            return Err(format!("jce: negative length {n}"));
        }
        Ok(n as usize)
    }

    pub fn read_int64(&mut self, tag: u8, default: i64) -> Result<i64, String> {
        match self.seek_tag(tag)? {
            None => Ok(default),
            Some(ty) => self.read_i64_payload(ty),
        }
    }

    pub fn read_int32(&mut self, tag: u8, default: i32) -> Result<i32, String> {
        Ok(self.read_int64(tag, default as i64)? as i32)
    }

    pub fn read_int16(&mut self, tag: u8, default: i16) -> Result<i16, String> {
        Ok(self.read_int64(tag, default as i64)? as i16)
    }

    pub fn read_int8(&mut self, tag: u8, default: i8) -> Result<i8, String> {
        Ok(self.read_int64(tag, default as i64)? as i8)
    }

    pub fn read_string(&mut self, tag: u8, default: String) -> Result<String, String> {
        match self.seek_tag(tag)? {
            None => Ok(default),
            Some(TYPE_STRING1) => {
                let len = self.take(1)?[0] as usize;
                let bytes = self.take(len)?;
                String::from_utf8(bytes.to_vec()).map_err(|e| format!("jce: bad utf8: {e}"))
            }
            Some(TYPE_STRING4) => {
                let len = u32::from_be_bytes(self.take(4)?.try_into().unwrap()) as usize;
                let bytes = self.take(len)?;
                String::from_utf8(bytes.to_vec()).map_err(|e| format!("jce: bad utf8: {e}"))
            }
            Some(ty) => Err(format!("jce: type {ty} is not a string")),
        }
    }

    pub fn read_bytes(&mut self, tag: u8) -> Result<Option<Vec<u8>>, String> {
        match self.seek_tag(tag)? {
            None => Ok(None),
            Some(TYPE_SIMPLE_LIST) => {
                let (elem_ty, _) = self.read_head()?;
                if elem_ty != TYPE_BYTE {
                    return Err(format!("jce: simple_list elem type {elem_ty} != byte"));
                }
                let len = self.read_len()?;
                Ok(Some(self.take(len)?.to_vec()))
            }
            Some(ty) => Err(format!("jce: type {ty} is not simple_list")),
        }
    }

    /// map<string, bytes> (UniAttribute). Absent → None.
    pub fn read_map_string_bytes(
        &mut self,
        tag: u8,
    ) -> Result<Option<Vec<(String, Vec<u8>)>>, String> {
        match self.seek_tag(tag)? {
            None => Ok(None),
            Some(TYPE_MAP) => {
                let len = self.read_len()?;
                let mut out = Vec::with_capacity(len);
                for _ in 0..len {
                    let key = self.read_string(0, String::new())?;
                    let value = self.read_bytes(1)?.unwrap_or_default();
                    out.push((key, value));
                }
                Ok(Some(out))
            }
            Some(ty) => Err(format!("jce: type {ty} is not a map")),
        }
    }

    /// map<string, map<string, bytes>> — the "complex" UniAttribute layout
    /// Huya sometimes returns instead of the flat one.
    #[allow(clippy::type_complexity)]
    pub fn read_map_string_map_bytes(
        &mut self,
        tag: u8,
    ) -> Result<Option<Vec<(String, Vec<(String, Vec<u8>)>)>>, String> {
        match self.seek_tag(tag)? {
            None => Ok(None),
            Some(TYPE_MAP) => {
                let len = self.read_len()?;
                let mut out = Vec::with_capacity(len);
                for _ in 0..len {
                    let key = self.read_string(0, String::new())?;
                    let inner = match self.seek_tag(1)? {
                        Some(TYPE_MAP) => {
                            let n = self.read_len()?;
                            let mut m = Vec::with_capacity(n);
                            for _ in 0..n {
                                let k = self.read_string(0, String::new())?;
                                let v = self.read_bytes(1)?.unwrap_or_default();
                                m.push((k, v));
                            }
                            m
                        }
                        Some(ty) => return Err(format!("jce: inner type {ty} is not a map")),
                        None => Vec::new(),
                    };
                    out.push((key, inner));
                }
                Ok(Some(out))
            }
            Some(ty) => Err(format!("jce: type {ty} is not a map")),
        }
    }

    /// Open a struct field: consumes head(10, tag). Absent → false.
    #[allow(dead_code)] // consumed by the huya danmaku client
    pub fn read_struct_begin(&mut self, tag: u8) -> Result<bool, String> {
        match self.seek_tag(tag)? {
            None => Ok(false),
            Some(TYPE_STRUCT_BEGIN) => Ok(true),
            Some(ty) => Err(format!("jce: type {ty} is not a struct")),
        }
    }

    /// Close the current struct: skip remaining fields up to head(11, 0).
    #[allow(dead_code)] // consumed by the huya danmaku client
    pub fn read_struct_end(&mut self) -> Result<(), String> {
        loop {
            let (ty, _) = self.read_head()?;
            if ty == TYPE_STRUCT_END {
                return Ok(());
            }
            self.skip_field(ty)?;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hand-compose map<string, map<string, bytes>> at the given tag.
    /// (The encoder only needs the flat variant; tests build the nested one
    /// by wrapping a flat-map body in an outer map entry.)
    fn encode_nested_map(tag: u8, outer_key: &str, inner: &[(String, Vec<u8>)]) -> Vec<u8> {
        let mut inner_enc = JceEncoder::new();
        inner_enc.write_map_string_bytes(1, inner);
        let inner_body = inner_enc.to_bytes();

        let mut buf = Vec::new();
        buf.push(if tag < 15 { (tag << 4) | TYPE_MAP } else { 0xF0 | TYPE_MAP });
        if tag >= 15 {
            buf.push(tag);
        }
        let mut sz = JceEncoder::new();
        sz.write_int32(0, 1);
        buf.extend_from_slice(&sz.to_bytes());
        let mut k = JceEncoder::new();
        k.write_string(0, outer_key);
        buf.extend_from_slice(&k.to_bytes());
        buf.extend_from_slice(&inner_body);
        buf
    }

    #[test]
    fn head_layout_short_and_extended_tags() {
        let mut e = JceEncoder::new();
        e.write_int8(0, 5);
        assert_eq!(e.to_bytes(), vec![0x00, 0x05]); // tag 0, type 0, value 5

        let mut e = JceEncoder::new();
        e.write_int8(16, 5);
        assert_eq!(e.to_bytes(), vec![0xF0, 16, 0x05]); // extended tag
    }

    #[test]
    fn int_shrinks_to_smallest_width() {
        let mut e = JceEncoder::new();
        e.write_int64(0, 0);
        assert_eq!(e.to_bytes(), vec![0x0C]); // zero tag only

        let mut e = JceEncoder::new();
        e.write_int64(0, 127);
        assert_eq!(e.to_bytes(), vec![0x00, 127]); // byte

        let mut e = JceEncoder::new();
        e.write_int64(0, 300);
        assert_eq!(e.to_bytes(), vec![0x01, 0x01, 0x2C]); // short BE

        let mut e = JceEncoder::new();
        e.write_int64(0, 100_000);
        assert_eq!(e.to_bytes(), vec![0x02, 0x00, 0x01, 0x86, 0xA0]); // int BE

        let mut e = JceEncoder::new();
        e.write_int64(0, 5_000_000_000);
        assert_eq!(e.to_bytes().len(), 9); // long: head + 8
    }

    #[test]
    fn round_trip_scalars_and_strings() {
        let mut e = JceEncoder::new();
        e.write_int64(0, -123);
        e.write_string(2, "hello 弹幕");
        e.write_int32(5, 70000);
        let bytes = e.to_bytes();

        let mut d = JceDecoder::new(&bytes);
        assert_eq!(d.read_int64(0, -1).unwrap(), -123);
        // tag 1 absent — seek must skip tag 0 and stop at tag 2 > 1
        assert_eq!(d.read_string(1, "none".to_string()).unwrap(), "none");
        assert_eq!(d.read_string(2, String::new()).unwrap(), "hello 弹幕");
        assert_eq!(d.read_int32(5, 0).unwrap(), 70000);
        assert_eq!(d.read_int32(9, 42).unwrap(), 42, "missing trailing tag");
    }

    #[test]
    fn round_trip_bytes_and_lists_and_maps() {
        let mut inner = JceEncoder::new();
        inner.write_string(0, "payload");
        let inner_bytes = inner.to_bytes();

        let mut e = JceEncoder::new();
        e.write_bytes(1, &inner_bytes);
        e.write_string_list(2, &["live:123".to_string(), "chat:123".to_string()]);
        e.write_map_string_bytes(3, &[("tReq".to_string(), inner_bytes.clone())]);
        e.write_empty_map(4);
        let bytes = e.to_bytes();

        let mut d = JceDecoder::new(&bytes);
        assert_eq!(d.read_bytes(1).unwrap(), Some(inner_bytes.clone()));

        // list<string> is read via manual walk (no dedicated helper needed)
        let mut d2 = JceDecoder::new(&bytes);
        d2.read_bytes(1).unwrap();
        // skip to tag 2 (list) manually:
        match d2.seek_tag(2).unwrap() {
            Some(TYPE_LIST) => {
                let len = d2.read_len().unwrap();
                assert_eq!(len, 2);
                assert_eq!(d2.read_string(0, String::new()).unwrap(), "live:123");
                assert_eq!(d2.read_string(0, String::new()).unwrap(), "chat:123");
            }
            _ => panic!("expected list at tag 2"),
        }

        // read_* helpers do their own seek — a fresh decoder can jump
        // straight to tag 3.
        let mut d3 = JceDecoder::new(&bytes);
        let map = d3.read_map_string_bytes(3).unwrap().unwrap();
        assert_eq!(map.len(), 1);
        assert_eq!(map[0].0, "tReq");
        assert_eq!(map[0].1, inner_bytes);
        // empty map at tag 4 decodes as Some([])
        assert_eq!(d3.read_map_string_bytes(4).unwrap(), Some(vec![]));
    }

    #[test]
    fn round_trip_nested_struct() {
        // inner struct { 0: int64 1001, 2: string "小明" }
        let mut inner = JceEncoder::new();
        inner.write_int64(0, 1001);
        inner.write_string(2, "小明");

        // outer: { 0: struct inner, 3: string "666" }
        let mut e = JceEncoder::new();
        e.write_struct_raw(0, &inner.to_bytes());
        e.write_string(3, "666");

        let bytes = e.to_bytes();
        let mut d = JceDecoder::new(&bytes);
        assert!(d.read_struct_begin(0).unwrap());
        assert_eq!(d.read_int64(0, -1).unwrap(), 1001);
        assert_eq!(d.read_string(2, String::new()).unwrap(), "小明");
        d.read_struct_end().unwrap();
        assert_eq!(d.read_string(3, String::new()).unwrap(), "666");
    }

    #[test]
    fn decoder_skips_unknown_field_types() {
        // tag 0: float(4) 1.5 — a field type we never explicitly read
        let mut buf = vec![0x04];
        buf.extend_from_slice(&1.5f32.to_be_bytes());
        let mut e2 = JceEncoder::new();
        e2.write_int32(1, 7);
        buf.extend_from_slice(&e2.to_bytes());

        let mut d = JceDecoder::new(&buf);
        assert_eq!(d.read_int32(1, 0).unwrap(), 7);
    }

    #[test]
    fn flat_map_reader_rejects_nested_layout() {
        let mut rsp = JceEncoder::new();
        rsp.write_string(0, "token123");
        let buf = encode_nested_map(0, "tRsp", &[("GetCdnTokenExResp".to_string(), rsp.to_bytes())]);

        // The flat reader must fail (value is a map, not bytes) so callers
        // can fall back to the nested reader.
        let mut d = JceDecoder::new(&buf);
        assert!(d.read_map_string_bytes(0).is_err());
    }

    #[test]
    fn read_complex_uni_attribute() {
        let mut rsp = JceEncoder::new();
        rsp.write_string(0, "token123");
        let buf = encode_nested_map(0, "tRsp", &[("GetCdnTokenExResp".to_string(), rsp.to_bytes())]);

        let mut d = JceDecoder::new(&buf);
        let m = d.read_map_string_map_bytes(0).unwrap().unwrap();
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].0, "tRsp");
        assert_eq!(m[0].1.len(), 1);
        assert_eq!(m[0].1[0].0, "GetCdnTokenExResp");
        let mut rd = JceDecoder::new(&m[0].1[0].1);
        assert_eq!(rd.read_string(0, String::new()).unwrap(), "token123");
    }
}
