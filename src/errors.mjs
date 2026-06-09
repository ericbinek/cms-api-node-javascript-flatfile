function createError(status, error, message, details = [], path = '') {
  return { status, error, message, details, path };
}

export function validationError(details, path) {
  return createError(400, 'VALIDATION_ERROR', 'Invalid request data.', details, path);
}

export function invalidJsonError(path) {
  return createError(400, 'INVALID_JSON', 'Request body is not valid JSON.', [], path);
}

export function invalidIdError(path) {
  return createError(400, 'INVALID_ID', 'ID must be a valid UUID.', [], path);
}

export function notFoundError(resource, path) {
  return createError(404, 'NOT_FOUND', `${resource} not found.`, [], path);
}

export function routeNotFoundError(path) {
  return createError(404, 'ROUTE_NOT_FOUND', 'No route matches this request.', [], path);
}

export function methodNotAllowedError(allowed, path) {
  return createError(405, 'METHOD_NOT_ALLOWED', `Method not allowed. Allowed: ${allowed.join(', ')}.`, [], path);
}

export function preconditionRequiredError(path) {
  return createError(428, 'PRECONDITION_REQUIRED', 'If-Match header required for this operation.', [], path);
}

export function preconditionFailedError(path) {
  return createError(412, 'PRECONDITION_FAILED', 'ETag does not match current resource state.', [], path);
}

export function referentialError(details, path) {
  return createError(422, 'REFERENTIAL_ERROR', 'Referenced resource does not exist.', details, path);
}

export function payloadTooLargeError(path) {
  return createError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large.', [], path);
}

export function unsupportedMediaTypeError(path) {
  return createError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Request body must be application/json.', [], path);
}

export function internalError(path) {
  return createError(500, 'INTERNAL_ERROR', 'Internal server error.', [], path);
}
