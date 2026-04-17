const {
  APPOINTMENT_SERVICE_URL,
  NOTIFICATION_SERVICE_URL,
  SERVICE_NAME,
  DOWNSTREAM_TIMEOUT_MS,
  DOWNSTREAM_MAX_RETRIES,
} = require("../config/paymentConfig");

const RETRYABLE_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

// Parse JSON defensively so a non-JSON error body still produces a usable message.
const parseJsonSafe = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (_err) {
    return { message: text };
  }
};

// Internal requests include a service identity header for downstream observability.
const buildHeaders = () => {
  return {
    "Content-Type": "application/json",
    "x-service-name": SERVICE_NAME,
  };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry only transient classes of failures; permanent errors should fail fast.
const shouldRetryError = (error) => {
  if (error.name === "AbortError") return true;
  if (typeof error.statusCode === "number") {
    return RETRYABLE_STATUSES.has(error.statusCode);
  }

  return false;
};

// Abort slow downstream calls so payment requests never hang indefinitely.
const fetchWithTimeout = async (url, options) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNSTREAM_TIMEOUT_MS);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

// Retry bounded requests while preserving the first useful failure response.
const requestJson = async (url, options) => {
  let lastError;

  for (let attempt = 0; attempt <= DOWNSTREAM_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options);
      const data = await parseJsonSafe(response);

      if (!response.ok) {
        const message = data.message || `Request failed with status ${response.status}`;
        const error = new Error(message);
        error.statusCode = response.status;
        throw error;
      }

      return data;
    } catch (error) {
      lastError = error;

      if (attempt === DOWNSTREAM_MAX_RETRIES || !shouldRetryError(error)) {
        throw error;
      }

      await wait(Math.min(1000, 100 * (attempt + 1)));
    }
  }

  throw lastError || new Error("Downstream request failed");
};

// Probe the canonical endpoint first, then fallback-compatible variants.
const tryEndpoints = async (baseUrl, endpointCandidates, options) => {
  let lastError;

  for (const endpoint of endpointCandidates) {
    try {
      return await requestJson(`${baseUrl}${endpoint}`, options);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Downstream request failed");
};

// Appointment-service owns the billing truth; payment-service only consumes it.
const getAppointmentById = async (appointmentId) => {
  const data = await tryEndpoints(
    APPOINTMENT_SERVICE_URL,
    [`/appointments/${appointmentId}`, `/api/appointments/${appointmentId}`],
    {
      method: "GET",
      headers: buildHeaders(),
    }
  );

  return data.appointment || data.data || data;
};

// Normalize the appointment payload shape across versions of the upstream service.
const resolveFee = (appointment) => {
  return (
    appointment.consultationFee ??
    appointment.consultation_fee ??
    appointment.fee ??
    appointment.amount ??
    appointment.billing?.consultationFee ??
    appointment.billing?.amount ??
    appointment.doctor?.consultationFee
  );
};

// Pull owner identifiers from whichever upstream shape is available.
const resolvePatientId = (appointment) => {
  return (
    appointment.patientId ||
    appointment.patient_id ||
    appointment.patient?.id ||
    appointment.patient?._id
  );
};

const resolveDoctorId = (appointment) => {
  return (
    appointment.doctorId ||
    appointment.doctor_id ||
    appointment.doctor?.id ||
    appointment.doctor?._id
  );
};

// Return the canonical billing view used for Stripe intent creation.
const getAppointmentBilling = async (appointmentId) => {
  const appointment = await getAppointmentById(appointmentId);
  const amount = resolveFee(appointment);

  if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
    const err = new Error("Appointment consultation fee is missing or invalid");
    err.statusCode = 502;
    throw err;
  }

  const patientId = resolvePatientId(appointment);
  const doctorId = resolveDoctorId(appointment);

  if (!patientId || !doctorId) {
    const err = new Error("Appointment payload is missing patient or doctor identifiers");
    err.statusCode = 502;
    throw err;
  }

  return {
    appointment,
    amount,
    patientId,
    doctorId,
    currency: appointment.currency || "lkr",
  };
};

// Idempotency key helps downstream updates stay safe on retries.
const updateAppointmentPaymentStatus = async ({ appointmentId, paymentStatus, paymentId }) => {
  const headers = buildHeaders();
  headers["x-idempotency-key"] = `appointment:${appointmentId}:${paymentStatus}`;

  return tryEndpoints(
    APPOINTMENT_SERVICE_URL,
    [
      `/appointments/${appointmentId}/payment-status`,
      `/api/appointments/${appointmentId}/payment-status`,
    ],
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ paymentStatus, paymentId }),
    }
  );
};

// Notification calls follow the same bounded retry and idempotency rules.
const sendPaymentNotification = async ({ patientId, doctorId, appointmentId, paymentStatus, amount, currency }) => {
  const headers = buildHeaders();
  headers["x-idempotency-key"] = `notification:${appointmentId}:${paymentStatus}`;

  return tryEndpoints(
    NOTIFICATION_SERVICE_URL,
    ["/notifications/payment-status", "/api/notifications/payment-status"],
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        patientId,
        doctorId,
        appointmentId,
        paymentStatus,
        amount,
        currency,
      }),
    }
  );
};

module.exports = {
  getAppointmentBilling,
  updateAppointmentPaymentStatus,
  sendPaymentNotification,
};
