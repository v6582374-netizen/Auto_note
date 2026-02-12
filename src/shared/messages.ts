export const PROTOCOL_VERSION = 1;

export interface MessageEnvelope<TPayload = unknown> {
  protocolVersion: number;
  type: string;
  payload?: TPayload;
}

export interface RuntimeResponse<TData = unknown> {
  ok: boolean;
  data?: TData;
  error?: string;
}
