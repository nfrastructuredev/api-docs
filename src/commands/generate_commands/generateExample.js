const {folders} = require('../../folders');
const logger = require('@nterprise/niagara-winston-logger')();
const _ = require('lodash');
const fs = require('fs');
const path = require('path');
const jsf = require('json-schema-faker');
const faker = require('faker');
const chance = require('chance');
const $RefParser = require('json-schema-ref-parser');

exports.builder = (yargs) => yargs.
    option(
        'add',
        {
            alias: 'a',
            describe: 'Add the example key to generated schemas',
            default: false,
            global: true,
            boolean: true,
        },
    ).
    option(
        'hidden',
        {
            alias: 'h',
            describe: 'Create hidden examples',
            default: false,
            boolean: true,
        },
    );

exports.command = 'example [schema]';
exports.describe = 'Creates examples from the schemas';

exports.handler = async (argv) => {
    logger.info('Generating examples');
    let schema = await $RefParser.dereference(folders.openApiDoc);
    // YAY OAS not supporting examples
    // Or json-schema-faker not supporting OAS
    let schemaJson = JSON.stringify(schema);
    schemaJson = schemaJson.replace(
        /x-examples/gm,
        'examples',
    );

    schemaJson = schemaJson.replace(
        /x-patternProperties/gm,
        'patternProperties',
    );

    schema = JSON.parse(schemaJson);

    _.unset(schema, 'Workflow.properties.steps.additionalProperties.anyOf');
    logger.debug('Updated from OAS to JSONSchema');

    jsf.extend('faker', () => faker);
    jsf.extend('chance', () => chance);
    jsf.option('requiredOnly', false);
    jsf.option('alwaysFakeOptionals', true);
    jsf.option('useExamplesValue', true);

    const sample = _.pickBy(
        // Generate the full sample. If we only select from argv.schema
        // Then references may not resolve
        await jsf.resolve(_.get(schema, 'components.schemas')),
        (sample, key) => argv.hidden
            || !_.get(schema, `components.schemas.${key}.x-ui-hide`, false),
    );

    logger.debug('Created examples');

    const schemasToWrite = argv.schema === '__all__'
        ? _.keys(sample)
        : [argv.schema];

    logger.debug('Writing examples');
    _.map(schemasToWrite, (name) => {
        logger.info(`Writing schema ${name}`);
        const matches = name.split(/(?=[A-Z])/gm);

        const folderParts = [
            folders.examples,
        ];

        switch (matches[0]) {
            case 'Workflow':
                if (matches.length > 2) {
                    folderParts.push(_.toLower(matches[0]));
                    folderParts.push(_.toLower(matches[1]));
                    folderParts.push(_.toLower(matches[2]));
                    name = name.replace(`WorkFlow${matches[2]}`, '');
                }
                break;
            case 'Input':
                if (matches.length > 2) {
                    folderParts.push(`${_.toLower(matches[0])}${matches[1]}`);
                    folderParts.push(_.toLower(matches[2]));
                    name = name.replace('InputFilter', '');
                }
                break;

            case 'Hal':
                if (matches.length > 2) {
                    folderParts.push(_.toLower(matches[0]));
                    name = name.replace('Hal', '');
                }
                break;
        }

        logger.debug(`New name ${name}`);
        const exampleFileName = _.camelCase(name);
        logger.debug(`Example File Name: ${exampleFileName}`);
        const exampleFolder = _.compact(folderParts).join('/');

        logger.debug(`Output folder ${exampleFolder}`);
        if (!fs.existsSync(exampleFolder)) {
            logger.debug('Creating folder');
            fs.mkdirSync(exampleFolder, {recursive: true});
        }

        argv._writeFile(
            `${exampleFolder}/${exampleFileName}.json`,
            JSON.stringify(_.get(sample, name), null, 2),
        );

        if (!argv.add) {
            return;
        }

        logger.debug('Adding example key to schema');

        try {
            folderParts[0] = folders.schemas;
            const schemaFolder = _.compact(folderParts).join('/');
            const ogSchemaFileName = `${schemaFolder}/${name}.json`;
            logger.debug(`Schema File: ${ogSchemaFileName}`);
            const ogSchema = require(ogSchemaFileName);
            const exampleRef = path.relative(
                schemaFolder,
                exampleFolder,
            );

            logger.debug(`Example Ref: ${exampleRef}`);
            _.set(
                ogSchema,
                'example',
                {'$ref': `${exampleRef}/${exampleFileName}.json`},
            );
            argv._writeFile(
                ogSchemaFileName,
                JSON.stringify(ogSchema, null, 2),
            );
        } catch (error) {
            logger.error(error);
        }
    });

    logger.info('Example(s) created');
};
