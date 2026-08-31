import { sendResponse } from '../../../../utils/response.js';
import { createSurvey, listSurveys, setSurveyStatus } from '../services/survey.service.js';
import { validateCreateSurveyDto, validateSurveyStatusDto } from '../validators/survey.validator.js';

export const createSurveyController = async (req, res, next) => {
    try {
        const dto = validateCreateSurveyDto(req.body);
        const result = await createSurvey(dto);
        return sendResponse(res, 201, 'Survey created successfully', result);
    } catch (err) {
        next(err);
    }
};

export const listSurveysController = async (req, res, next) => {
    try {
        const result = await listSurveys();
        return sendResponse(res, 200, 'Surveys retrieved successfully', result);
    } catch (err) {
        next(err);
    }
};

export const setSurveyStatusController = async (req, res, next) => {
    try {
        const { id } = req.params;
        const dto = validateSurveyStatusDto(req.body);
        const result = await setSurveyStatus(id, dto.status);
        return sendResponse(res, 200, 'Survey status updated successfully', result);
    } catch (err) {
        next(err);
    }
};
