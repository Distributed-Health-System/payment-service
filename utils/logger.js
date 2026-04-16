const toPayload = (level, message, meta = {}) => {
  return {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta,
  };
};

// Structured JSON logs are easier to search and parse in production systems.
const info = (message, meta = {}) => {
  console.log(JSON.stringify(toPayload("info", message, meta)));
};

const warn = (message, meta = {}) => {
  console.warn(JSON.stringify(toPayload("warn", message, meta)));
};

const error = (message, meta = {}) => {
  console.error(JSON.stringify(toPayload("error", message, meta)));
};

module.exports = {
  info,
  warn,
  error,
};
