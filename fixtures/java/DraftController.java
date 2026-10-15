// Synthetic educational example. Not copied from a business repository.
public class DraftController {
    private DraftService draftService;

    @PostMapping("/drafts/submit")
    public SubmissionResult submit(SubmitRequest request) {
        if (request.revision() < 1) {
            throw new IllegalArgumentException("Invalid revision");
        }
        return draftService.submit(request);
    }
}
