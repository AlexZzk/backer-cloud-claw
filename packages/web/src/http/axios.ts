import axios from "axios";

const service = axios.create({
    baseURL: import.meta.env.VITE_APP_BASE_API, // API前缀
    timeout: 60000,
});

// 请求拦截器
service.interceptors.request.use(
    (config) => {
        // 可以在这里加入 token
        // const token = localStorage.getItem("token")
        // if (token) config.headers.Authorization = `Bearer ${token}`

        console.log("请求地址:", config.baseURL + config.url);

        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// 响应拦截器
service.interceptors.response.use(
    (response) => {
        console.log(response)
        return response;
    },
    (error) => {
        console.error("请求错误:", error);
        return Promise.reject(error);
    }
);

export default service;
