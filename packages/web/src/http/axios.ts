import axios from "axios";

const service = axios.create({
    baseURL: import.meta.env.VITE_BASE_API || '/', // 所有的请求地址前缀部分
    timeout: 60000, // 请求超时时间毫秒
    withCredentials: true, // 异步请求携带cookie
    headers: {
        // 设置后端需要的传参类型
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
    },
})

// 请求拦截器
service.interceptors.request.use(
)
service.interceptors.response.use(
)

export default service
