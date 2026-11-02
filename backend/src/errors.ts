export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const unauthorized = (m = 'No autenticado') => new HttpError(401, m);
export const forbidden = (m = 'No tiene permisos para esta acción') => new HttpError(403, m);
export const notFound = (m = 'No encontrado') => new HttpError(404, m);
export const conflict = (m: string, d?: unknown) => new HttpError(409, m, d);
export const unprocessable = (m: string, d?: unknown) => new HttpError(422, m, d);
