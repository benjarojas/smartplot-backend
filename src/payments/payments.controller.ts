import { Body, Controller, Get, Post, Param, ParseIntPipe, Query, Request, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { CreatePaymentDto } from 'src/dto/create-payment.dto';
import { PaymentsService } from './payments.service';
import { Payment } from 'src/entities/payment.entity';
import { StartTrxResponseDto } from 'src/dto/start-trx-response.dto';
import { Public } from 'src/decorators/public.decorator';
import { ApiOperation, ApiProperty } from '@nestjs/swagger';
import { Roles } from 'src/decorators/roles.decorator';
import { Role } from 'src/enums/role.enum';
import { canViewPayment } from 'src/auth/policies/user.policy';
import { InvoiceService } from 'src/invoice/invoice.service';
import { ParcelService } from 'src/parcel/parcel.service';
import { Invoice } from 'src/entities/invoice.entity';
import { UsersService } from 'src/users/users.service';
import { User } from 'src/entities/user.entity';

@Controller('payments')
@Roles(Role.Admin, Role.ParcelOwner)
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService,
                private readonly invoiceService: InvoiceService,
                private readonly parcelService: ParcelService,
    ) {}

    @ApiOperation({
        summary: 'Iniciar una transacción de pago con Webpay',
        description: 'Permite iniciar una transacción de pago utilizando Webpay. Requiere los datos del pago (ver CreatePaymentDto). Administradores y propietarios de parcelas pueden iniciar transacciones.',
    })
    @Post('webpay/start-trx')
    async startTransaction(
        @Body() createPaymentDto: CreatePaymentDto,
        @Request() req,    
    ): Promise<StartTrxResponseDto> {
        return this.paymentsService.startWebpayPayment(createPaymentDto, req.user.sub);
    }

    @ApiOperation({
        summary: 'Confirmar una transacción de pago con Webpay (uso interno)',
        description: 'Permite confirmar una transacción de pago utilizando Webpay. Requiere el token de la transacción. Importante: este endpoint debe ser llamado únicamente por Transbank, no desde el frontend. Este endpoint es público.',
    })
    @Public()
    @Get('webpay/commit-trx')
    async commitTransaction(@Query('token_ws') token: string): Promise<Payment> {
        return this.paymentsService.commitWebpayPayment(token);
    }

    @ApiOperation({
        summary: 'Ingresa un pago manualmente',
        description: 'Permite ingresar un pago manualmente en el sistema. Requiere los datos del pago (ver CreatePaymentDto). Este endpoint es accesible solo para administradores. Está pensado para registrar pagos que no se procesan a través de Webpay, como pagos en efectivo o transferencias bancarias.',
    })
    @Post('manual')
    @Roles(Role.Admin)
    async createPayment(
        @Body() createPaymentDto: CreatePaymentDto,
        @Request() req,
    ): Promise<Payment> {
        return this.paymentsService.createManualPayment(createPaymentDto, req.user.sub);
    }

    @ApiOperation({
        summary: 'Obtener todos los pagos',
        description: 'Retorna un array de todos los pagos registrados en el sistema. Este endpoint es accesible solo para administradores.',
    })
    @Get()
    @Roles(Role.Admin)
    async getAllPayments(): Promise<Payment[]> {
        return this.paymentsService.findAllPayments();
    }

    @ApiOperation({
        summary: 'Obtener un pago por ID',
        description: 'Retorna un pago específico por su ID. Si no se encuentra, retorna null. Este endpoint es accesible para administradores y propietarios de parcelas.',
    })
    @Get(':id')
    async getPaymentById(@Param('id', ParseIntPipe) id: number, @Request() req): Promise<Payment | null> {
        return this.paymentsService.findPaymentById(id);
    }

    @ApiOperation({
        summary: 'Obtener pagos por usuario',
        description: 'Retorna un array de pagos asociados a un usuario específico. Este endpoint es accesible para administradores y propietarios de parcelas.',
    })
    @Get('user/:userId')
    @Roles(Role.Admin, Role.ParcelOwner)
    async getPaymentsByUser(
        @Param('userId', ParseIntPipe) userId: number,
        @Request() req,
    ): Promise<Payment[]> {
        if( !canViewPayment({ id: req.user.sub, role: req.user.role}, [userId]) ) {
            throw new UnauthorizedException('Access denied: You do not have permission to view these payments.');
        }
        return this.paymentsService.findPaymentsByUser(userId);
    }

    // TODO: probar esto
    @ApiOperation({
        summary: 'Obtener pagos asociados a una nota de cobro',
        description: 'Retorna un array de pagos asociados a una nota de cobro específica. Este endpoint es accesible para administradores y propietarios de parcelas. Un administrador puede ver los pagos de cualquier nota de cobro, mientras que un propietario solo puede ver los pagos de las notas de cobro asociadas a sus parcelas.',
    })
    @Get('invoice/:invoiceId')
    async getPaymentsByInvoice(
        @Param('invoiceId', ParseIntPipe) invoiceId: number,
        @Request() req,
    ): Promise<Payment[]> {
        const invoice = await this.invoiceService.findInvoiceById(invoiceId);
        
        if (!invoice) {
            throw new NotFoundException('Invoice not found');
        }

        const parcel = await this.parcelService.findParcelById(invoice.parcel.id_parcel);

        if (!parcel) {
            throw new NotFoundException('Parcel not found');
        }

        const parcelOwners = (await this.parcelService.findParcelOwners(parcel.id_parcel)).map(owner => owner.id);
        console.log(`Parcel Owners: ${JSON.stringify(parcelOwners)}`);

        if (parcelOwners && parcelOwners.length > 0) {
            if (!canViewPayment({ id: req.user.sub, role: req.user.role }, parcelOwners)) {
                throw new UnauthorizedException('Access denied: You do not have permission to view these payments.');
            }
        }

        return this.paymentsService.findPaymentsByInvoice(invoiceId);
    }
}
