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
    getPrivacyConsent: () => request({ type: 'privacy.status' }),
    acceptPrivacyConsent: () => request({ type: 'privacy.accept', accepted: true }),
    disconnect: () => request({ type: 'pairing.disconnect' }),
    cancelPairing: () => request({ type: 'pairing.cancel' }),
    checkConnection: () => request({ type: 'connection.check' }),
    openApp: () => request({ type: 'app.open' }),
    savePairing: (token) => request({ type: 'pairing.save', token }),
    listResumes: () => request({ type: 'resumes.list' }),
    getAIModels: async () => {
      try {
        return await request({ type: 'ai.models' });
      } catch (error) {
        if (error?.code === 'invalid_runtime_response' || error?.code === 'unsupported_message') {
          throw new RuntimeMessageError({
            message: 'Reload On Paper Companion from chrome://extensions, then retry loading models.',
            code: 'extension_update_required',
            retryable: false,
          });
        }
        throw error;
      }
    },
    scanPage: () => request({ type: 'page.scan' }),
    createMapping: (profileContextId, resumeId, descriptors, { job, model } = {}) => request({
      type: 'mapping.create',
      profileContextId,
      resumeId,
      descriptors,
      ...(job ? { job } : {}),
      ...(model ? { model } : {}),
    }),
    fillPage: (profileContextId, resumeId, fields, reviewContext) => request({
      type: 'page.fill', profileContextId, resumeId, fields,
      ...(reviewContext ? { reviewContext } : {}),
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
    analyzeJobFit: ({ profileContextId, resumeId, job, model }) => request({
      type: 'job.fit.analyze', profileContextId, resumeId, job, ...(model ? { model } : {}),
    }),
    createTailoredResume: ({ profileContextId, resumeId, requestId, job, model }) => request({
      type: 'resume.tailor', profileContextId, resumeId, requestId, job, ...(model ? { model } : {}),
    }),
  };
}

export const runtimeClient = createRuntimeClient();
