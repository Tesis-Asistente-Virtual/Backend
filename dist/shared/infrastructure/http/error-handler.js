import { ZodError } from 'zod';
import { EmailAlreadyRegistered } from '../../../modules/authentication/application/internal/command-services/sign-up.js';
import { InvalidCredentials } from '../../../modules/authentication/application/internal/command-services/sign-in.js';
import { InvalidRefreshToken } from '../../../modules/authentication/application/internal/command-services/refresh-session.js';
import { ProfileNotFound } from '../../../modules/users/application/internal/query-services/get-my-profile.js';
import { ConversationNotFound } from '../../../modules/conversations/application/internal/query-services/get-conversation.js';
import { AssistantGenerationUnavailable, ConversationArchived, InvalidConversationMessage } from '../../../modules/conversations/application/internal/command-services/send-conversation-message.js';
import { ConversationProcessingConsentError } from '../../../modules/conversations/application/ports/conversation-processing-consent.js';
import { ConversationTurnInProgress } from '../../../modules/conversations/application/ports/conversation-turn-lock.js';
import { ConsentNoticeUnavailable } from '../../../modules/consent/application/internal/command-services/record-my-consent-decision.js';
import { ConsentIdempotencyConflict } from '../../../modules/consent/domain/model/consent-errors.js';
import { PreliminaryAssessmentError } from '../../../modules/preliminary-assessment/domain/model/assessment-errors.js';
import { MonitoringError } from '../../../modules/longitudinal-monitoring/domain/model/monitoring-errors.js';
import { LongitudinalMonitoringDomainError } from '../../../modules/longitudinal-monitoring/domain/model/monitoring-contracts.js';
import { SignalAuthorizationUnavailable, SignalConsentRequired, SignalConversationNotFound, SignalExtractionUnavailable, SignalMessageReferencesInvalid, } from '../../../modules/conversational-processing/application/internal/command-services/extract-authorized-conversation-signals.js';
import { ConversationSignalExtractionError } from '../../../modules/conversational-processing/application/ports/conversation-signal-extractor.js';
function hasUniqueViolationCode(error) {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
function isMalformedJsonBody(error) {
    if (typeof error !== 'object' || error === null || !('type' in error) || !('status' in error))
        return false;
    return error.type === 'entity.parse.failed' && error.status === 400;
}
export const errorHandler = (err, _req, res, _next) => {
    if (res.headersSent) {
        _next(err);
        return;
    }
    if (err instanceof ZodError) {
        res.status(400).json({ error: 'Invalid request data' });
        return;
    }
    if (isMalformedJsonBody(err)) {
        res.status(400).json({ error: 'Invalid JSON body' });
        return;
    }
    if (err instanceof EmailAlreadyRegistered || hasUniqueViolationCode(err)) {
        res.status(409).json({ error: 'Email is already registered' });
        return;
    }
    if (err instanceof InvalidCredentials || err instanceof InvalidRefreshToken) {
        res.status(401).json({ error: err instanceof InvalidCredentials ? 'Invalid email or password' : 'Invalid refresh token' });
        return;
    }
    if (err instanceof ProfileNotFound) {
        res.status(404).json({ error: 'Profile not found' });
        return;
    }
    if (err instanceof ConversationNotFound) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
    }
    if (err instanceof SignalConversationNotFound) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
    }
    if (err instanceof SignalMessageReferencesInvalid) {
        res.status(400).json({ error: 'Conversation message references are invalid' });
        return;
    }
    if (err instanceof SignalConsentRequired) {
        res.status(403).json({ error: 'Current consent is required for conversation signal extraction' });
        return;
    }
    if (err instanceof SignalAuthorizationUnavailable) {
        res.status(503).json({ error: 'Consent status is temporarily unavailable' });
        return;
    }
    if (err instanceof SignalExtractionUnavailable) {
        res.status(503).json({ error: 'Conversation signal extraction is temporarily unavailable' });
        return;
    }
    if (err instanceof ConversationSignalExtractionError) {
        if (err.kind === 'invalid_input') {
            res.status(400).json({ error: 'Invalid extraction request' });
            return;
        }
        if (err.kind === 'cancelled') {
            res.status(503).json({ error: 'Conversation signal extraction was interrupted' });
            return;
        }
        res.status(503).json({ error: 'Conversation signal extraction is temporarily unavailable' });
        return;
    }
    if (err instanceof ConversationArchived || err instanceof ConversationTurnInProgress) {
        res.status(409).json({ error: err instanceof ConversationArchived ? 'Conversation is archived' : 'Conversation turn already in progress' });
        return;
    }
    if (err instanceof InvalidConversationMessage) {
        res.status(400).json({ error: 'Invalid conversation message' });
        return;
    }
    if (err instanceof ConversationProcessingConsentError) {
        if (err.code === 'consent_required') {
            res.status(403).json({ error: 'Current ai_conversation_processing consent is required' });
            return;
        }
        res.status(503).json({ error: 'Consent status is temporarily unavailable' });
        return;
    }
    if (err instanceof ConsentNoticeUnavailable) {
        res.status(404).json({ error: 'Consent notice is unavailable' });
        return;
    }
    if (err instanceof ConsentIdempotencyConflict) {
        res.status(409).json({ error: 'Consent decision conflicts with an earlier request' });
        return;
    }
    if (err instanceof PreliminaryAssessmentError) {
        if (err.code === 'assessment_not_found' || err.code === 'result_not_found') {
            res.status(404).json({ error: err.code === 'assessment_not_found' ? 'Assessment not found' : 'Assessment result not found' });
            return;
        }
        if (err.code === 'consent_required') {
            res.status(403).json({ error: 'Current consent is required' });
            return;
        }
        if (['invalid_transition', 'assessment_closed', 'instrument_unavailable', 'responses_incomplete', 'concurrent_modification', 'result_conflict'].includes(err.code)) {
            res.status(409).json({ error: 'Assessment operation conflicts with its current state or availability' });
            return;
        }
        res.status(400).json({ error: 'Invalid assessment request' });
        return;
    }
    if (err instanceof MonitoringError) {
        if (err.code === 'enrollment_not_found') {
            res.status(404).json({ error: 'Monitoring enrollment not found' });
            return;
        }
        if (err.code === 'session_not_found' || err.code === 'conversation_not_found') {
            res.status(404).json({ error: 'Monitoring session or conversation not found' });
            return;
        }
        if (err.code === 'consent_required') {
            res.status(403).json({ error: 'Current longitudinal monitoring consent is required' });
            return;
        }
        if (err.code === 'conversation_association_not_authorized') {
            res.status(403).json({ error: 'Current notice does not authorize conversation association' });
            return;
        }
        if (err.code === 'consent_unavailable') {
            res.status(503).json({ error: 'Consent status is temporarily unavailable' });
            return;
        }
        if (['invalid_transition', 'enrollment_inactive', 'enrollment_already_open', 'session_already_open', 'concurrent_modification', 'session_inactive', 'conversation_inactive', 'conversation_already_associated'].includes(err.code)) {
            res.status(409).json({ error: 'Monitoring operation conflicts with its current state' });
            return;
        }
    }
    if (err instanceof LongitudinalMonitoringDomainError) {
        if (err.code === 'consent_required') {
            res.status(403).json({ error: 'Current longitudinal monitoring consent is required' });
            return;
        }
        if (err.code === 'enrollment_inactive' || err.code === 'invalid_transition') {
            res.status(409).json({ error: 'Monitoring operation conflicts with its current state' });
            return;
        }
        res.status(400).json({ error: 'Invalid monitoring request' });
        return;
    }
    if (err instanceof AssistantGenerationUnavailable) {
        res.status(503).json({ error: 'Text generation is temporarily unavailable' });
        return;
    }
    console.error('Unhandled request error');
    res.status(500).json({ error: 'Internal server error' });
};
