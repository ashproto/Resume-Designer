export class RuntimeMessageError extends Error {
  constructor({
    message = 'The extension background returned an error',
    status = null,
    code = 'runtime_error',
    retryable = false,
  } = {}) {
    super(message);
    this.name = 'RuntimeMessageError';
    this.status = status;
    this.code = code;
    this.retryable = Boolean(retryable);
  }
}

function defaultSendMessage(message) {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return Promise.reject(new RuntimeMessageError({
      message: 'Extension messaging is unavailable',
      code: 'runtime_unavailable',
      retryable: true,
    }));
  }
  return globalThis.chrome.runtime.sendMessage(message);
}

export function createRuntimeClient(sendMessage = defaultSendMessage) {
  async function request(message) {
    let response;
    try {
      response = await sendMessage(message);
    } catch (error) {
      if (error instanceof RuntimeMessageError) throw error;
      throw new RuntimeMessageError({
        message: error instanceof Error ? error.message : 'Extension messaging failed',
        code: 'runtime_unavailable',
        retryable: true,
      });
    }

    if (
      response?.ok === true
      && Object.prototype.hasOwnProperty.call(response, 'data')
    ) {
      return response.data;
    }

    if (response?.ok === false && response.error && typeof response.error === 'object') {
      throw new RuntimeMessageError(response.error);
    }

    throw new RuntimeMessageError({
      message: 'The extension background returned an invalid response',
      code: 'invalid_runtime_response',
      retryable: true,
    });
  }

  return {
    checkConnection: () => request({ type: 'connection.check' }),
    savePairing: (token) => request({ type: 'pairing.save', token }),
    listResumes: () => request({ type: 'resumes.list' }),
    scanPage: () => request({ type: 'page.scan' }),
    createMapping: (resumeId, descriptors) => request({
      type: 'mapping.create',
      resumeId,
      descriptors,
    }),
    fillPage: (resumeId, fields) => request({ type: 'page.fill', resumeId, fields }),
    saveAnswer: (question, answer) => request({ type: 'answer.save', question, answer }),
    logApplication: ({ variantId, company, title, ...optional }) => {
      const message = { type: 'application.log', variantId, company, title };
      if (Object.prototype.hasOwnProperty.call(optional, 'notes')) {
        message.notes = optional.notes;
      }
      return request(message);
    },
  };
}

export const runtimeClient = createRuntimeClient();
