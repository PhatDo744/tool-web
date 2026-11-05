let token='';
const el=id=>document.getElementById(id);
const messages={UNAUTHORIZED:'Mã quản trị không khớp cấu hình của bản deploy hiện tại. Nếu vừa đổi ADMIN_TOKEN trên Vercel, hãy Redeploy rồi thử lại.',ADMIN_NOT_CONFIGURED:'Máy chủ chưa có ADMIN_TOKEN hợp lệ (tối thiểu 32 ký tự). Đặt biến cho Production trên Vercel rồi Redeploy.',SERVICE_UNAVAILABLE:'Chưa kết nối được database. Kiểm tra cấu hình máy chủ.',RATE_LIMITED:'Quá nhiều yêu cầu. Vui lòng chờ một phút.',INVALID_INPUT:'Thông tin chưa hợp lệ.'};
async function api(action,values={}){
 const response=await fetch('/api/index',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action,...values})});
 const data=await response.json();if(!response.ok)throw Error(messages[data.error]||data.error||'Có lỗi xảy ra.');return data;
}
function notify(message){el('status').textContent=message;}
async function refresh(){
 const {licenses}=await api('list');
 el('total').textContent=licenses.length;
 el('active').textContent=licenses.filter(l=>l.activated_at&&!l.revoked_at&&new Date(l.expires_at)>new Date()).length;
 el('pending').textContent=licenses.filter(l=>!l.activated_at&&!l.revoked_at).length;
 el('licenses').replaceChildren();el('empty').hidden=licenses.length>0;
 for(const l of licenses){
  const row=document.createElement('tr');
  const state=l.revoked_at?'Đã thu hồi':!l.activated_at?'Chờ kích hoạt':new Date(l.expires_at)<=new Date()?'Hết hạn':'Đang dùng';
  const values=[l.label||'Không có ghi chú',state,`${l.devices}/${l.max_devices}`,l.expires_at?new Date(l.expires_at).toLocaleString('vi-VN'):`${l.duration_days} ngày sau kích hoạt`];
  values.forEach((value,index)=>{const td=document.createElement('td');if(index===1){const badge=document.createElement('span');badge.className='pill '+(state==='Đang dùng'?'':state==='Chờ kích hoạt'?'muted':'danger');badge.textContent=value;td.append(badge);}else td.textContent=value;row.append(td);});
  const td=document.createElement('td');if(!l.revoked_at){
   if(l.devices>0){const reset=document.createElement('button');reset.textContent='Gỡ thiết bị';reset.onclick=async()=>{if(!confirm('Gỡ tất cả thiết bị của key này? Hạn dùng giữ nguyên. App phải kích hoạt lại; thiết bị đang chạy sẽ bị từ chối khi kiểm tra tiếp theo.'))return;reset.disabled=true;try{await api('reset-devices',{id:l.id});await refresh();notify('Đã gỡ thiết bị. Hãy kích hoạt lại trên ứng dụng mới. Hạn dùng được giữ nguyên.');}catch(e){notify(e.message);reset.disabled=false;}};td.append(reset);}
const button=document.createElement('button');button.textContent='Thu hồi';button.onclick=async()=>{if(!confirm('Thu hồi key này? Ứng dụng sẽ bị từ chối trong lần kiểm tra tiếp theo.'))return;button.disabled=true;try{await api('revoke',{id:l.id});await refresh();notify('Đã thu hồi key.');}catch(e){notify(e.message);button.disabled=false;}};td.append(button);}row.append(td);el('licenses').append(row);
 }
}
el('login-form').onsubmit=async event=>{event.preventDefault();token=el('token').value.trim();try{await refresh();el('token').value='';el('login').hidden=true;el('dashboard').hidden=false;el('logout').hidden=false;notify('');}catch(e){token='';notify(e.message);}};
el('logout').onclick=()=>{token='';el('new-key').value='';el('generated').hidden=true;el('dashboard').hidden=true;el('login').hidden=false;el('logout').hidden=true;el('licenses').replaceChildren();notify('Đã đăng xuất.');};
el('create-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{const result=await api('create',{label:el('label').value,durationDays:Number(el('days').value),maxDevices:Number(el('devices').value)});el('new-key').value=result.key;el('generated').hidden=false;notify('Đã tạo key. Hãy sao chép và lưu lại ngay.');await refresh();}catch(e){notify(e.message);}finally{button.disabled=false;}};
el('refresh').onclick=()=>refresh().catch(e=>notify(e.message));
el('copy').onclick=async()=>{try{await navigator.clipboard.writeText(el('new-key').value);notify('Đã sao chép key.');}catch{el('new-key').select();notify('Chọn và sao chép key trong ô.');}};
