import axios from 'axios'
import type { User, SKU, Lot } from '../types'

// Khi build cho Render: đặt VITE_API_BASE_URL = https://<backend>.onrender.com/api
// Khi dev local: bỏ trống -> dùng '/api' (vite proxy sang localhost:8080).
const api = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// Auth
export const login = (username: string, password: string) =>
  api.post<{ token: string; user: User }>('/auth/login', { username, password }).then((r) => r.data)

export const getMe = () =>
  api.get<User>('/auth/me').then((r) => r.data)

// SKU
export const listSKUs = (q?: string) =>
  api.get<SKU[]>('/skus', { params: q ? { q } : undefined }).then((r) => r.data)

export const getSKU = (id: number) =>
  api.get<SKU>(`/skus/${id}`).then((r) => r.data)

export const createSKU = (data: { sku_code: string; name: string; unit?: string }) =>
  api.post<SKU>('/skus', data).then((r) => r.data)

export const updateSKU = (id: number, data: { name: string; unit?: string }) =>
  api.put(`/skus/${id}`, data)

export const deleteSKU = (id: number) =>
  api.delete(`/skus/${id}`)

// Lot
export const upsertLot = (data: {
  sku_id: number
  lot_number: string
  manufacture_date?: string
  expiry_date?: string
  qty: number
  branch?: string
  notes?: string
}) => api.post<Lot>('/lots', data).then((r) => r.data)

export const updateLot = (id: number, data: {
  manufacture_date?: string
  expiry_date?: string
  qty: number
  notes?: string
}) => api.put<Lot>(`/lots/${id}`, data).then((r) => r.data)

export const deleteLot = (id: number) =>
  api.delete(`/lots/${id}`)

// Users
export const listUsers = () =>
  api.get<User[]>('/users').then((r) => r.data)

export const createUser = (data: {
  username: string
  password: string
  full_name: string
  branch: string
  role?: string
}) => api.post<User>('/users', data).then((r) => r.data)

export const deleteUser = (id: number) =>
  api.delete(`/users/${id}`)
