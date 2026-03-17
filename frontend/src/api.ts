const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export const apiUrl = (path: string) => {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (!path.startsWith('/')) return `${API_BASE_URL}/${path}`;
  return `${API_BASE_URL}${path}`;
};

