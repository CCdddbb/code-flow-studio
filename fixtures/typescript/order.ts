// Public, synthetic example written for Code Flow Studio. No database is connected.
interface OrderInput {
  customer: string;
  amount: number;
  note: string;
}

export function createOrder(input: OrderInput) {
  const envelope = toEnvelope(input);
  if (input.amount <= 0) {
    throw new Error("Amount must be positive");
  }
  orderRepository.save(envelope);
  notificationQueue.publish(envelope);
  return envelope;
}

function toEnvelope(input: OrderInput) {
  const payload = {
    customerName: input.customer,
    total: input.amount,
    memo: input.note,
    status: "PENDING"
  };
  return payload;
}

// External ports are intentionally declarations: their implementation is unknown.
declare const orderRepository: { save(value: unknown): void };
declare const notificationQueue: { publish(value: unknown): void };
