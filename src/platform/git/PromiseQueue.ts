export class PromiseQueue {
	private tail: Promise<unknown> = Promise.resolve();

	enqueue<T>(task: () => Promise<T>): Promise<T> {
		const run = this.tail.then(task, task);
		this.tail = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}
