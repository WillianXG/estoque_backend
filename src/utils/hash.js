import bcrypt from "bcrypt";

export const hashSenha = senha => bcrypt.hash(senha, 10);
export const comparaSenha = (senha, hash) => bcrypt.compare(senha, hash);
