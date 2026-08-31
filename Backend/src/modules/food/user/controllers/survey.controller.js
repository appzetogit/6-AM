import { sendResponse } from '../../../../utils/response.js';
import { getActiveSurveyForUser, submitSurveyResponse } from '../../admin/services/survey.service.js';
import { validateSubmitSurveyResponseDto } from '../../admin/validators/survey.validator.js';

export const getActiveSurveyController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const result = await getActiveSurveyForUser(userId);
        return sendResponse(res, 200, 'Survey check completed', result);
    } catch (err) {
        next(err);
    }
};

export const submitSurveyResponseController = async (req, res, next) => {
    try {
        const { userId } = req.user;
        const { surveyId } = req.params;
        const dto = validateSubmitSurveyResponseDto(req.body);
        const result = await submitSurveyResponse(userId, surveyId, dto.answers);
        return sendResponse(res, 200, 'Survey response submitted successfully', result);
    } catch (err) {
        next(err);
    }
};
