export class SignUpController {
    signUp;
    constructor(signUp) {
        this.signUp = signUp;
    }
    async handle(req, res) {
        const account = await this.signUp.execute(req.body);
        res.status(201).json({
            id: account.id,
            email: account.email,
            message: 'Cuenta registrada correctamente',
        });
    }
}
