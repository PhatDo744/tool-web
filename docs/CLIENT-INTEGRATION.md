# Tích hợp vào modnro

## Các điểm đã xác định

- `Mod Nro Pc/Main.cs`: `Main.Start()` khởi tạo Unity client; cần chặn khởi tạo game trước khi cấp phép thành công.
- `Mod Nro Pc/ModCak.csproj`: net35, dùng UnityEngine DLL của bản game; không giả định có UnityWebRequest/JSON API hiện đại.
- `QLTK Nro Pro`: launcher .NET 8 Windows; kiểm tra launcher bổ sung trải nghiệm nhưng không thay kiểm tra bên trong mod (người dùng có thể chạy game trực tiếp).
- Chưa có bằng chứng về project build Android/iOS độc lập trong checkout đã khảo sát. Cần xác minh phiên bản Unity và pipeline mobile trước khi chọn networking API.

## Luồng bắt buộc trong từng client

1. Trước màn chơi, hiển thị ô nhập key. Giữ tất cả tính năng được bảo vệ ở trạng thái khóa.
2. Lấy định danh thiết bị ổn định, tối thiểu 16 ký tự. Với Unity có thể băm `SystemInfo.deviceUniqueIdentifier` kèm namespace của sản phẩm sau khi kiểm tra giá trị không rỗng/unsupported. Nếu không có định danh phù hợp, sinh UUID cài đặt một lần và lưu trong vùng dữ liệu riêng; cài lại app có thể bị tính là thiết bị mới.
3. POST JSON tới endpoint HTTPS cố định, `action=activate` sau khi người dùng nhập key. Chỉ cần lưu key trong kho bí mật của hệ điều hành (Windows DPAPI, Android Keystore, iOS Keychain); không log key.
4. Chỉ sau HTTP 200 + JSON hợp lệ + `valid=true`, mới chạy luồng khởi tạo/tính năng mod. Mỗi lần khởi động phải gọi `check` trực tuyến, không tin cờ license đã lưu cục bộ.
5. Kiểm tra lại mỗi 300 giây theo thời gian thực/monotonic, không dùng tick game bị ảnh hưởng timeScale. Khi quay lại foreground cũng kiểm tra. Không để nhiều coroutine kiểm tra chồng nhau.
6. Trong lúc chưa xác thực hoặc khi hết hạn, thu hồi, timeout/mất mạng: dừng auto và chặn các chức năng được bảo vệ; giải phóng socket/tác vụ nền phù hợp. Không chỉ ẩn cửa sổ giao diện.
7. Hỗ trợ thông báo tiếng Việt cho lỗi hết hạn, thiết bị vượt giới hạn, cần kích hoạt và dịch vụ tạm không khả dụng.

## Ranh giới bảo vệ

Không nhúng ADMIN_TOKEN, DATABASE_URL hoặc bí mật máy chủ vào app. Key là thông tin bearer; định danh thiết bị do client cung cấp có thể bị giả mạo khi client bị sửa. Key cùng ID thiết bị bị sao chép có thể qua kiểm tra; ràng buộc này phục vụ cấp phép thông thường, không phải chứng thực phần cứng. Có thể tăng độ khó bằng platform attestation và ký yêu cầu bằng khóa thiết bị, cần thiết kế riêng theo nền tảng.

Code Unity/.NET phân phối cho người dùng có thể bị patch để bỏ qua kiểm tra. Obfuscation chỉ tăng chi phí sửa đổi. Muốn bảo vệ mạnh hơn, chuyển tác vụ giá trị cốt lõi sang server và kiểm tra quyền tại server đó. Backend web này chưa làm việc đó.

## Tiêu chí kiểm thử trước phát hành

- Khởi động trực tiếp game không qua launcher vẫn yêu cầu key.
- Mở lại app không gia hạn; chỉnh giờ máy không gia hạn.
- Key hết hạn/thu hồi bị khóa trong tối đa một chu kỳ kiểm tra 5 phút khi app đang hoạt động.
- Thiết bị thứ hai bị từ chối khi giới hạn 1; cùng thiết bị nhiều tab không chiếm thêm slot.
- Mất mạng, TLS sai và server 503 đều không mở khóa.
- Kiểm tra trên PC và từng bản Android/iOS thật; không coi API dùng chung là bằng chứng mobile đã tích hợp.
