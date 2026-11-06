# ModPDT License Console · tool-web

Web tiếng Việt quản lý key cho PC / Android / iOS, triển khai bằng Vercel Functions + PostgreSQL. Không dùng file JSON hay bộ nhớ serverless làm nơi lưu key.

## Cơ chế cấp key

1. Quản trị đăng nhập bằng `ADMIN_TOKEN` (tối thiểu 32 ký tự, nên sinh ngẫu nhiên 32 byte).
2. Nhập ghi chú khách hàng, thời hạn 1–3650 ngày và giới hạn 1–100 thiết bị. Mặc định 30 ngày / 1 thiết bị; có thể thay đổi từng key.
3. Máy chủ sinh key ngẫu nhiên 192 bit. Cơ sở dữ liệu lưu SHA-256 để xác thực và AES-256-GCM để quản trị viên xem lại key; không lưu key gốc dạng rõ. Gửi key riêng cho khách, không đặt key trong URL.
4. App gửi key + định danh cài đặt vào API `activate`. Lần kích hoạt thành công đầu tiên bắt đầu tính hạn theo giờ PostgreSQL. Các lần sau không gia hạn.
5. App gọi `check` lúc mở ứng dụng và mỗi 300 giây. Key bị thu hồi, hết hạn hoặc thiết bị chưa đăng ký bị từ chối. Không cho tiếp tục dùng khi kiểm tra lỗi.
6. Thu hồi key tại dashboard. App đang hoạt động nhận trạng thái mới ở lần kiểm tra tiếp theo; việc đóng ứng dụng phải được thực hiện trong client.

Không có chức năng tự đăng ký/cấp key công khai. Quản trị đăng nhập bằng mã quản trị để nhận cookie phiên được ký, HttpOnly + Secure + SameSite=Strict, 30 ngày kể từ lần đăng nhập/khôi phục phiên gần nhất. F5 tự khôi phục phiên; đăng xuất xóa cookie, đổi ADMIN_TOKEN làm các phiên cũ mất hiệu lực. Không lưu mã quản trị trong localStorage hoặc cookie. Thao tác dùng cookie kiểm tra Origin/Fetch Metadata để chặn yêu cầu khác nguồn.

## Chạy cục bộ

Node.js >=22 (đã kiểm tra Node 24), PostgreSQL tương thích Neon/Supabase.

```sh
npm ci
cp .env.example .env.local
# Điền DATABASE_URL và ADMIN_TOKEN vào .env.local bằng trình soạn thảo an toàn.
npm run db:init
npm test
npm run dev
```

Sinh ADMIN_TOKEN bằng password manager hoặc `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` trên máy riêng. Không gửi giá trị trong chat, không commit file môi trường. Giữ xác minh TLS của database; không dùng `rejectUnauthorized: false`.

## Public trên Vercel lần đầu

1. Tạo tài khoản tại https://vercel.com bằng GitHub. Tạo tài khoản tại https://console.neon.tech và project PostgreSQL (có thể dùng gói miễn phí theo điều kiện nhà cung cấp).
2. Neon → **Connect** → sao chép connection string có TLS. Chọn endpoint pooled cho Vercel. Lưu trực tiếp vào Vercel, không gửi trong chat.
3. Vercel → **Add New → Project** → import `PhatDo744/tool-web`. Cho phép Vercel đọc repository nếu chưa thấy nó. Framework chọn **Other**, Node.js **24.x**.
4. Trong **Environment Variables**, đặt `DATABASE_URL` là connection string và `ADMIN_TOKEN` là chuỗi bí mật mạnh của bạn. Không cần thêm biến để lưu và xem lại key. Áp dụng cho Production; chỉ bật Preview nếu muốn dùng chung database ở môi trường preview.
5. Deploy. `vercel.json` chạy `npm run db:init` trong build để tạo bảng; build sẽ thất bại nếu database chưa kết nối được. Output Directory là `public`. API ở `/api/index`.
6. Mở domain Vercel vừa cấp → đăng nhập quản trị → tạo một key thử → gọi `activate`, `check`, thu hồi key rồi gọi `check` lại. Đừng phát hành bản mod trước khi kiểm tra đủ quy trình với URL production.

Nếu thay env sau deploy, cần **Redeploy** để function nhận cấu hình mới. Có thể đổi ADMIN_TOKEN để thu hồi quyền quản trị cũ; các license hiện có không bị ảnh hưởng. Database migration có thể chạy lặp lại mà không xóa key.

## API cho client

Tất cả request đều POST JSON qua HTTPS tới `https://TEN-PROJECT.vercel.app/api/index`.

Kích hoạt (không gửi ADMIN_TOKEN):

```json
{"action":"activate","key":"NRO-<48 ký tự hex>","deviceId":"<định danh cài đặt ít nhất 16 ký tự>","platform":"pc"}
```

Kiểm tra định kỳ: cùng dữ liệu, thay `action` bằng `check`. `platform` nhận `pc`, `android`, `ios`.

```json
{"valid":true,"expiresAt":"2026-12-05T00:00:00.000Z","serverTime":"2026-11-05T00:00:00.000Z","checkAfterSeconds":300}
```

Client chỉ mở tính năng sau HTTP 200 và `valid === true`. Mọi lỗi HTTP, timeout, JSON lỗi hoặc `valid` khác true phải khóa tính năng. Cần timeout request hữu hạn; không tắt TLS/certificate validation. Không dùng đồng hồ máy khách để quyết định hết hạn. Xem `docs/CLIENT-INTEGRATION.md` trước khi tích hợp.

Lỗi: 400 `INVALID_INPUT`; 403 `LICENSE_INVALID`, `DEVICE_LIMIT`, `ACTIVATION_REQUIRED`; 429 `RATE_LIMITED`; 503 `SERVICE_UNAVAILABLE`. Giới hạn 60 request/phút/IP cho mỗi nhóm client/quản trị; cân nhắc điều chỉnh cho phòng máy chung NAT. Dashboard hiển thị 200 key gần nhất.

## Kiểm thử và giới hạn

`npm test` dùng PostgreSQL chạy WASM qua PGlite để thực thi schema/SQL thật và kiểm thử API: xác thực quản trị, tạo/kích hoạt/kiểm tra/thu hồi, số thiết bị, hết hạn, input lỗi, rate limit và migration lặp lại. Chưa thay thế kiểm thử kết nối TLS tới PostgreSQL production hoặc xác minh deploy trên Vercel. `SELECT ... FOR UPDATE` trên license tuần tự hóa kích hoạt cùng key trong PostgreSQL production; kiểm thử cạnh tranh production vẫn cần database thật.

Repo `modnro` được khảo sát có launcher WinForms .NET 8 và mod Unity net35. Chưa tích hợp hoặc build lại bản mod trong thay đổi này; chưa xác minh có project mobile riêng. Web/API không tự khóa các bản app đã phát hành. Chỉ công bố cơ chế kiểm soát có hiệu lực sau khi tích hợp và thử nghiệm client trên từng nền tảng.

### Gỡ thiết bị khi nâng cấp client

Dashboard có nút **Gỡ thiết bị** cho key đã kích hoạt. Thao tác yêu cầu mã quản trị và xác nhận, xóa các thiết bị đã gắn nhưng giữ nguyên hạn dùng/trạng thái thu hồi. App cũ sẽ bị từ chối trong lần check tiếp theo; app mới có thể activate lại trong số thiết bị cho phép. Dùng một lần khi chuyển từ ID Unity cũ sang ID dùng chung QLTK/game; không cần tạo key mới.

## Xem lại key và key cũ

Web tự mã hóa key bằng AES-256-GCM, suy ra khóa có phân tách mục đích từ ADMIN_TOKEN đã cấu hình. Không cần nhập thêm LICENSE_ENCRYPTION_KEY. Key cấp cho khách vẫn sinh ngẫu nhiên; không phải ADMIN_TOKEN.

Nếu đã có LICENSE_ENCRYPTION_KEY riêng, hệ thống tiếp tục dùng nó và đọc được các bản mã v1 cũ. Đây là cấu hình tùy chọn, không cần xóa hoặc nhập lại. Giữ ổn định bí mật dùng mã hóa và sao lưu an toàn.

Đổi ADMIN_TOKEN trong chế độ tự động: trước khi đổi, đặt LICENSE_ENCRYPTION_KEY bằng giá trị ADMIN_TOKEN cũ trong Vercel (không gửi vào chat), sau đó đổi ADMIN_TOKEN và Redeploy cùng lúc. Cách này giữ khả năng đọc key tự động cũ và tách mã đăng nhập mới khỏi mã hóa. Nếu đã dùng biến mã hóa riêng từ đầu, đổi ADMIN_TOKEN không ảnh hưởng các key v1.

Dashboard có **Xem key** cho key đã có bản mã. Chỉ quản trị viên được gọi API `reveal`; danh sách thường không trả key hoặc ciphertext, phản hồi không được cache. Key hiện trong khung sao chép và được xóa khỏi giao diện khi đăng xuất.

Các key phát hành trước bản cập nhật chỉ có hash nên không thể đảo ngược lấy bản gốc. Khi client gửi lại key đúng, server lưu thêm bản mã bằng cấu hình quản trị có sẵn; không tự cấp quyền hay đăng ký thiết bị từ thao tác bổ sung này. Nhấn Làm mới để thấy nút Xem key. Nếu key đã mất và không có client nào gửi lại, dùng **Cấp lại key**: mã cũ ngừng hoạt động, thiết bị được gỡ, hạn dùng/giới hạn thiết bị giữ nguyên. Không cấp lại key đã thu hồi.

Không có LICENSE_ENCRYPTION_KEY vẫn tạo, cấp lại và xem key bình thường qua cấu hình quản trị hiện có. Build Vercel tự thêm cột encrypted_key bằng migration chạy lặp lại an toàn; không cần tự sửa SQL hay xóa dữ liệu.

### Phiên quản trị và hộp thoại xem key

Sau khi đăng nhập lần đầu với bản cập nhật, web giữ phiên 30 ngày kể từ lần đăng nhập/khôi phục phiên gần nhất, kể cả F5. Mỗi lần quay lại web và xác thực phiên thành công sẽ gia hạn thêm 30 ngày. Mã quản trị chỉ dùng khi đăng nhập và không được giữ trong JavaScript sau khi máy chủ cấp cookie. Đăng xuất xóa cookie trên trình duyệt; phiên hết hạn sẽ yêu cầu đăng nhập lại.

Bấm Xem key mở hộp thoại tại chỗ với trạng thái tải, key và nút sao chép. Lỗi giải mã/API cũng hiển thị ngay trong hộp thoại. Đóng hộp thoại hoặc đăng xuất xóa key khỏi trường hiển thị. Tính năng không thay đổi mã/hạn dùng của key; Cấp lại key vẫn cần xác nhận riêng.
