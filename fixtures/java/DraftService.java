// A small illustrative Java service; annotations/ports are intentionally unresolved.
public class DraftService {
    private SubmissionRepository submissionRepository;
    private DraftStore draftStore;
    private BusinessWriter businessWriter;

    @Transactional
    public SubmissionResult submit(SubmitRequest request) {
        var acceptance = submissionRepository.findByKey(request.submitKey());
        if (acceptance != null) {
            return acceptance.result();
        }
        draftStore.freeze(request.draftId(), request.revision());
        var business = businessWriter.create(request.draftId());
        submissionRepository.save(business);
        return new SubmissionResult("COMMITTED", business.id());
    }
}
