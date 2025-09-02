import { Router } from 'express';
import { DeploymentService } from '../../../deployment/src/deploymentService';
import { logger } from '../../../utils/src/logger';

const router = Router();

// GET /api/templates - List templates
router.get('/', async (req, res) => {
  try {
    const { project_id, global } = req.query;
    const deploymentService = req.app.locals.deployment as DeploymentService;

    // Validate query parameter combinations like Rust version
    const isGlobal = global === 'true';
    const hasProjectId = project_id && typeof project_id === 'string';

    let templates;
    
    if (!isGlobal && !global && !hasProjectId) {
      // All templates: Global and project-specific
      templates = await deploymentService.getTaskTemplateModel().findAll();
    } else if (isGlobal && !hasProjectId) {
      // Only global templates
      templates = await deploymentService.getTaskTemplateModel().findGlobal();
    } else if (!isGlobal && hasProjectId) {
      // Only project-specific templates
      templates = await deploymentService.getTaskTemplateModel().findByProjectId(project_id as string);
    } else if (global === 'false' && !hasProjectId) {
      // No global templates, but project_id is None, return empty list
      templates = [];
    } else if (isGlobal && hasProjectId) {
      // Invalid combination: Cannot query both global and project-specific templates
      return res.status(400).json({
        success: false,
        data: null,
        error_data: { error: 'Cannot query both global and project-specific templates' },
        message: 'Invalid query parameter combination'
      });
    } else {
      templates = await deploymentService.getTaskTemplateModel().findAll();
    }

    res.json({
      success: true,
      data: templates,
      error_data: null,
      message: null
    });

  } catch (error) {
    logger.error('Failed to list templates:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: { error: error instanceof Error ? error.message : 'Unknown error' },
      message: 'Failed to list templates'
    });
  }
});

// GET /api/templates/:id - Get template by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deploymentService = req.app.locals.deployment as DeploymentService;

    const template = await deploymentService.getTaskTemplateModel().findById(id);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: { error: 'Template not found' },
        message: 'Template not found'
      });
    }

    res.json({
      success: true,
      data: template,
      error_data: null,
      message: null
    });

  } catch (error) {
    logger.error('Failed to get template:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: { error: error instanceof Error ? error.message : 'Unknown error' },
      message: 'Failed to get template'
    });
  }
});

// POST /api/templates - Create new template
router.post('/', async (req, res) => {
  try {
    const deploymentService = req.app.locals.deployment as DeploymentService;
    const { title, description, template_name, project_id } = req.body;

    // Match Rust's validation behavior - return 422 with plain text for missing fields
    if (!title) {
      res.status(422);
      res.type('text/plain');
      return res.send('Failed to deserialize the JSON body into the target type: missing field `title`');
    }

    if (!template_name) {
      res.status(422);
      res.type('text/plain');
      return res.send('Failed to deserialize the JSON body into the target type: missing field `template_name`');
    }

    const template = await deploymentService.getTaskTemplateModel().create({
      title,
      description,
      template_name,
      project_id
    });

    res.status(200).json({
      success: true,
      data: template,
      error_data: null,
      message: null
    });

  } catch (error) {
    logger.error('Failed to create template:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: { error: error instanceof Error ? error.message : 'Unknown error' },
      message: 'Failed to create template'
    });
  }
});

// PUT /api/templates/:id - Update template
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deploymentService = req.app.locals.deployment as DeploymentService;
    const { title, description, template_name } = req.body;

    const template = await deploymentService.getTaskTemplateModel().update(id, {
      title,
      description,
      template_name
    });

    res.json({
      success: true,
      data: template,
      error_data: null,
      message: 'Template updated successfully'
    });

  } catch (error) {
    logger.error('Failed to update template:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: { error: error instanceof Error ? error.message : 'Unknown error' },
      message: 'Failed to update template'
    });
  }
});

// DELETE /api/templates/:id - Delete template
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deploymentService = req.app.locals.deployment as DeploymentService;

    const deletedCount = await deploymentService.getTaskTemplateModel().delete(id);
    
    if (deletedCount === 0) {
      return res.status(404).json({
        success: false,
        data: null,
        error_data: { error: 'Template not found' },
        message: 'Template not found'
      });
    }

    res.json({
      success: true,
      data: { deleted: true },
      error_data: null,
      message: 'Template deleted successfully'
    });

  } catch (error) {
    logger.error('Failed to delete template:', error);
    res.status(500).json({
      success: false,
      data: null,
      error_data: { error: error instanceof Error ? error.message : 'Unknown error' },
      message: 'Failed to delete template'
    });
  }
});

export default router;