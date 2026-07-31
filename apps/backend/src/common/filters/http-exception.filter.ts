import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

// Fanger ALLE unntak (@Catch() uten argument) som ikke er håndtert et annet sted, og formaterer dem
// til ett konsekvent JSON-format. Uten dette ville f.eks. en class-validator-feil, en ForbiddenException
// fra en guard, og en ukjent runtime-feil (f.eks. en Prisma-feil) hatt tre forskjellige responsformer -
// noe som gjør det tungvint for en frontend å håndtere feil generisk.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.extractMessage(exception, isHttpException);

    const body: ErrorResponseBody = {
      statusCode: status,
      error: isHttpException ? exception.constructor.name : 'InternalServerError',
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    // Ukjente feil (500) logges med full stacktrace server-side, men vi sender ALDRI stacktrace
    // eller interne detaljer til klienten - det kan lekke informasjon om systemets indre oppbygning
    // som er nyttig for en angriper.
    if (!isHttpException) {
      // eslint-disable-next-line no-console -- egen pino-logger kobles inn her når feilhåndtering utvides
      console.error(exception);
    }

    response.status(status).json(body);
  }

  private extractMessage(exception: unknown, isHttpException: boolean): string | string[] {
    if (!isHttpException) {
      return 'Intern serverfeil';
    }

    const httpException = exception as HttpException;
    const exceptionResponse = httpException.getResponse();

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null && 'message' in exceptionResponse) {
      // ValidationPipe kaster BadRequestException med message som en liste (én streng per feilt felt).
      return (exceptionResponse as { message: string | string[] }).message;
    }

    return httpException.message;
  }
}
