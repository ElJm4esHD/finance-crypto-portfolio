// Errors meant to be shown to the user as-is (HTTP 400 with a clear message).
export class UserError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends UserError {
  constructor(message = 'No encontrado') {
    super(message, 404);
  }
}
