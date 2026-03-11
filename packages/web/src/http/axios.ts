import axios, { type AxiosRequestConfig } from "axios";

/**
 * 覆盖 AxiosInstance 的方法签名，使 service.get<T>() 返回 Promise<T>，
 * 而非 Promise<AxiosResponse<T>>。
 * 这与响应拦截器中解包 {code, msg, data} 信封的行为一致。
 */
declare module "axios" {
  interface AxiosInstance {
    get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
    post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
    put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
    delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
  }
}

const service = axios.create({
    baseURL: import.meta.env.VITE_APP_BASE_API as string | undefined,
    timeout: 60000,
});

// 请求拦截器
service.interceptors.request.use(
    (config) => {
        console.log("请求地址:", (config.baseURL ?? '') + (config.url ?? ''));
        return config;
    },
    (error) => {
        return Promise.reject(error as unknown);
    }
);

// 响应拦截器：解包 {code, msg, data} 信封
service.interceptors.response.use(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (response): any => {
        const res = response.data as unknown;
        // 识别标准信封格式
        if (
            res !== null &&
            typeof res === 'object' &&
            'code' in res &&
            'msg' in res &&
            'data' in res
        ) {
            const envelope = res as { code: string; msg: string; data: unknown };
            if (envelope.code !== '') {
                // 业务错误：用 msg 作为错误信息
                return Promise.reject(new Error(envelope.msg || envelope.code));
            }
            // 成功：直接返回 data 字段
            return envelope.data;
        }
        // 非标准信封（如健康检查降级），直接返回原始数据
        return res;
    },
    (error) => {
        console.error("请求错误:", error);
        return Promise.reject(error as unknown);
    }
);

export default service;
