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
    openApp: () => request({ type: 'app.open' }),
    savePairing: (token) => request({ type: 'pairing.save', token }),
    listResumes: () => request({ type: 'resumes.list' }),
    scanPage: () => request({ type: 'page.scan' }),
    createMapping: (profileContextId, resumeId, descriptors) => request({
      type: 'mapping.create',
      profileContextId,
      resumeId,
      descriptors,
    }),
    fillPage: (profileContextId, resumeId, fields) => request({
      type: 'page.fill', profileContextId, resumeId, fields,
    }),
    saveAnswer: (profileContextId, question, answer) => request({
      type: 'answer.save', profileContextId, question, answer,
    }),
    logApplication: ({ profileContextId, variantId, company, title, ...optional }) => {
      const message = {
        type: 'application.log', profileContextId, variantId, company, title,
      };
      if (Object.prototype.hasOwnProperty.call(optional, 'notes')) {
        message.notes = optional.notes;
      }
      return request(message);
    },
    analyzeJobFit: ({ profileContextId, resumeId, job }) => request({
      type: 'job.fit.analyze', profileContextId, resumeId, job,
    }),
    createTailoredResume: ({ profileContextId, resumeId, requestId, job }) => request({
      type: 'resume.tailor', profileContextId, resumeId, requestId, job,
    }),
  };
}

export const runtimeClient = createRuntimeClient();
