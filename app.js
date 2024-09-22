const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const ejs = require('ejs');
const fastify = require('fastify')({ logger: true });
const fastifyStaticPlugin = require('@fastify/static');
const fastifyViewPlugin = require('@fastify/view');
const fs = require('fs').promises;
const path = require('path');

const loadQuestions = async () => {
    try {
        const questionData = await fs.readFile(path.join(__dirname, 'questions.json'), 'utf-8');
        return JSON.parse(questionData);
    } catch (err) {
        fastify.log.error('Error reading the questions file:', err);
        return [];
    }
};

const getAnswerUrl = (questionId, request) => {
    const urlBase = `${request.protocol}://${request.hostname}`;
    return `${urlBase}/questions/${questionId}/answer`;
};

const generateQRCode = async (text) => {
    return new Promise((resolve, reject) => {
        QRCode.toBuffer(text, (err, buffer) => {
            if (err) reject(err);
            else resolve(buffer);
        });
    });
};

const setupRoutes = (questions) => {
    fastify.get('/', async (_request, reply) => {
        return reply.send(); // Blank page
    });

    fastify.get('/questions', async (_request, reply) => {
        return reply.view('questions', { questions });
    });

    fastify.get('/questions/:questionId', async (request, reply) => {
        const questionId = parseInt(request.params.questionId, 10);
        const question = questions.find((q) => q.id === questionId);
        if (question) {
            return reply.view('question', { question });
        }
        return reply.status(404).send('Question not found');
    });

    fastify.get('/questions/:questionId/answer', async (request, reply) => {
        const questionId = parseInt(request.params.questionId, 10);
        const question = questions.find((q) => q.id === questionId);
        if (question) {
            return reply.view('answer', { question, answer: question.correctAnswer });
        }
        return reply.status(404).send('Question not found');
    });

    fastify.get('/questions/:questionId/answer/qrcode', async (request, reply) => {
        const { questionId } = request.params;
        const qrData = getAnswerUrl(questionId, request);

        try {
            const qrCodeImage = await QRCode.toDataURL(qrData);
            reply.type('image/png').send(Buffer.from(qrCodeImage.split(',')[1], 'base64'));
        } catch (err) {
            request.log.error(err);
            reply.status(500).send('Error generating QR code');
        }
    });

    fastify.get('/questions/:questionId/pdf-document', async (request, reply) => {
        const questionId = parseInt(request.params.questionId, 10);
        const question = questions.find((q) => q.id === questionId);
        if (!question) {
            return reply.status(404).send('Question not found');
        }

        const doc = new PDFDocument({
            size: 'A4',
            layout: 'landscape',
            margin: 50,
        });

        doc.font('Helvetica');

        // Add static image in top left corner
        doc.image(path.join(__dirname, 'public', 'logo.png'), 50, 50, { width: 100 });

        // Calculate available width
        const availableWidth = doc.page.width - 100; // 50 points margin on each side

        // Calculate question height
        const questionOptions = {
            width: availableWidth,
            align: 'center',
        };
        const questionHeight = doc.heightOfString(question, questionOptions);

        // Calculate answers height
        const answers = question.options.map(option => `${option.id}. ${option.text}`);
        const answerHeight = answers.length * 30; // 30 points per answer

        // Calculate total content height
        const totalContentHeight = questionHeight + 30 + answerHeight; // 30 points gap between question and answers

        // Calculate start Y position to center content vertically
        const startY = (doc.page.height - totalContentHeight) / 2;

        // Add question
        doc.fontSize(24);
        doc.text(question.text, 50, startY, questionOptions);

        // Add answers
        doc.fontSize(20);
        const answerStartY = startY + questionHeight + 80; // 80 points gap after question
        answers.forEach((answer, index) => {
            doc.text(answer, 100, answerStartY + index * 30);
        });

        // Generate QR code for correct answer
        const qrCodeBuffer = await generateQRCode(getAnswerUrl(questionId, request));

        // Calculate positions for QR code and "Réponse :" text
        const qrCodeSize = 100;
        const qrCodeX = doc.page.width - 50 - qrCodeSize;
        const qrCodeY = doc.page.height - 50 - qrCodeSize;
        const textY = qrCodeY - 20; // 20 points above the QR code

        // Add text above QR code
        doc.fontSize(12);
        doc.text('Réponse :', qrCodeX, textY, {
            width: qrCodeSize,
            align: 'center'
        });

        // Add QR code in bottom right corner
        doc.image(qrCodeBuffer, qrCodeX, qrCodeY, { width: qrCodeSize });

        // Finalize the PDF
        doc.end();

        // Set response headers
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `inline; filename=quiz-150ans-${questionId}.pdf`);

        return reply.send(doc);
    });
};

const start = async () => {
    try {
        fastify.register(fastifyViewPlugin, {
            engine: {
                ejs: ejs,
            },
            root: path.join(__dirname, 'views'),
            viewExt: 'ejs',
        });

        fastify.register(fastifyStaticPlugin, {
            root: path.join(__dirname, 'public'),
            prefix: '/public/'
        });

        const questions = await loadQuestions();

        setupRoutes(questions);

        const port = process.env.PORT || 3000;
        await fastify.listen({ port, host: '0.0.0.0' });
        fastify.log.info(`Server listening on port ${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
