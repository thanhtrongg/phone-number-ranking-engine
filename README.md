# Phone Number Ranking Engine

Công cụ crawl và chấm điểm số đẹp từ các nhà mạng Việt Nam (Mobifone & Viettel).

## Cách 1: Dùng Extension (Khuyên dùng)

### Cài đặt

1. Mở Chrome, vào `chrome://extensions`
2. Bật **Developer mode** (góc phải trên)
3. Chọn **Load unpacked** → chọn thư mục `extension/` trong project
4. Icon extension xuất hiện trên thanh toolbar

### Sử dụng

1. Vào trang web của Mobifone (VD: `khosim.mobifone.vn`) hoặc Viettel (`viettel.vn`)
2. Click icon extension → extension tự động phát hiện nhà mạng
3. Nhập đầu số muốn quét (hoặc để mặc định)
4. Click **"Chạy Mobifone"** hoặc **"Chạy Viettel"**
5. Script chạy tự động, kết quả hiện trong console

Extension tự động lưu đầu số bạn đã nhập.

## Cách 2: Copy code vào DevTools

### Mobifone

1. Mở DevTools (F12) → tab **Console**
2. Copy nội dung file [`simsodepmobi.js`](simsodepmobi.js)
3. Dán vào console và Enter
4. Chờ script crawl xong, kết quả hiện trong console + tự động tải CSV

### Viettel

1. Mở DevTools (F12) → tab **Console**
2. Copy nội dung file [`simsodepviettel.js`](simsodepviettel.js)
3. Dán vào console và Enter
4. Chờ script crawl xong, kết quả hiện trong console + tự động tải CSV

## Script

| File | Nhà mạng | API |
|------|----------|-----|
| `simsodepmobi.js` | Mobifone | `khosim.mobifone.vn` |
| `simsodepviettel.js` | Viettel | `apigami.viettel.vn` |

Script sẽ:

1. Gọi API lấy danh sách sim theo đầu số
2. Chấm điểm từng số dựa trên các tiêu chí số đẹp
3. Tự động tải xuống file CSV gồm:
   - `*_all_sims_*.csv` – tất cả sim
   - `*_beautiful_sims_*.csv` – chỉ sim đạt điểm >= `minScore`
4. Copy danh sách số đẹp vào clipboard

## Cấu hình

Có thể chỉnh sửa trực tiếp trong file script hoặc qua extension.

### Mobifone (`simsodepmobi.js`)

```js
prefixes: ["093", "090", "077", "078", "079", "089", "070"], // đầu số cần quét
type: "TRA_TRUOC",                                             // loại sim
minScore: 45,                                                  // điểm tối thiểu
size: 100,                                                     // số bản ghi mỗi trang
concurrency: 5,                                                // số request đồng thời
maxPages: 10000,                                               // giới hạn trang
avoidDigits: [],                                               // số cần né (vd ["4"])
```

### Viettel (`simsodepviettel.js`)

```js
keySearches: ["09*"],            // từ khóa tìm kiếm
isdnType: 2,
pageSize: 45,
minScore: 45,
maxPagesPerKey: 500,
maxEmptyPages: 5,
delayBetweenRequestsMin: 4500,  // delay 4.5–9s giữa các request
delayBetweenRequestsMax: 9000,
avoidDigits: [],                 // số cần né (vd ["4"])
resumeFromCache: true,           // tiếp tục từ cache nếu có
```

## Hệ thống chấm điểm

Script chấm điểm dựa trên các tiêu chí của số đẹp Việt Nam:

### Tiêu chí cộng điểm

| Tiêu chí | Điểm (Mobi) | Điểm (Viettel) |
|----------|:-----------:|:--------------:|
| Lục quý cuối (6 số giống nhau) | 180 | 210 |
| Ngũ quý cuối | 140 | 180 |
| Tứ quý cuối | 105 | 155 |
| Tam hoa cuối | 80 | 95 |
| Sảnh tiến 6 số | 130 | 180 |
| Sảnh tiến 5 số | 100 | 150 |
| Sảnh tiến 4 số | 75 | 115 |
| Sảnh lùi 6 số | 90 | 115 |
| Sảnh lùi 5 số | 65 | 90 |
| Đuôi lộc phát (68, 86) | 55 | 60 |
| Đuôi thần tài (39, 79) | 50 | 55 |
| Đuôi ông địa (38, 78) | 45 | 45 |
| Lặp bộ 3 cuối (abcabc) | 105 | 120 |
| Gánh 6 số cuối | 110 | 120 |
| Gánh 5 số cuối | 85 | 95 |
| Gánh 4 số cuối | 65 | 70 |
| 3 cặp kép cuối (aabbcc) | 95 | 105 |
| 2 cặp kép cuối (aabb) | 60 | 70 |
| Đuôi dạng AA-BBB (vd 77666) | 105 | 145 |
| Đuôi dạng AAA-BB (vd 88822) | 105 | 145 |
| Đuôi dạng AAA-BBB (vd 888666) | 130 | 175 |
| 8 số cuối ≤ 3 chữ số khác nhau | 65 | 80 |
| 3 cặp lặp cuối (ababab) | 95 | 105 |
| Lặp cặp cuối (abab) | 70 | 80 |
| Đuôi ABC-ABC | 90 | - |
| Đuôi AB-CD-AB | 65 | - |
| Đuôi kép đẹp (88, 99, 66) | 40 | 45 |
| Tam hoa sát cuối | 45 | - |
| Cụm 5 số giống nhau trong đuôi | 100 | 125 |
| Cụm 4 số giống nhau trong đuôi | 80 | 105 |
| Cụm 3 số giống nhau trong đuôi | 55 | 65 |
| Ngũ quý nằm trong đuôi | 100 | 120 |
| Tứ quý nằm trong đuôi | 80 | 100 |
| Tam hoa nằm trong đuôi | 60 | 70 |
| Combo lộc phát + tam hoa | 45 | 55 |
| Combo cặp đẹp + tam hoa | 40 | 50 |

### Tiêu chí trừ điểm

| Tiêu chí | Điểm (Mobi) | Điểm (Viettel) |
|----------|:-----------:|:--------------:|
| Đuôi 49 hoặc 53 | -35 | -45 |

## Output

Sau khi chạy xong, dữ liệu được lưu vào:
- **window object**: `mobiBeautifulSims` / `viettelBeautifulSims`
- **CSV**: tự động tải xuống
- **Clipboard**: danh sách sim đẹp

## License

[MIT](LICENSE)
