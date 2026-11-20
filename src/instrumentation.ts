export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startExamFinalizer } = await import("@/lib/exam-finalizer");
    startExamFinalizer();
  }
}
