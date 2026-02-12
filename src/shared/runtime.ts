import { PROTOCOL_VERSION, type RuntimeResponse } from "./messages";

export async function sendRuntimeMessage<TData = unknown, TPayload = unknown>(
  type: string,
  payload?: TPayload
): Promise<TData> {
  const response = (await chrome.runtime.sendMessage({
    protocolVersion: PROTOCOL_VERSION,
    type,
    payload
  })) as RuntimeResponse<TData>;

  if (!response?.ok) {
    throw new Error(response?.error || "Runtime request failed.");
  }

  return response.data as TData;
}
