from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

PositiveID = Annotated[int, Field(gt=0, le=2_147_483_647, strict=True)]
Quantity = Annotated[int, Field(gt=0, le=1_000_000, strict=True)]
Name = Annotated[str, Field(min_length=1, max_length=100)]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class UserCreate(Input):
    name: Name
    email: EmailStr = Field(max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return value.lower()


class ProductCreate(Input):
    name: Name
    price: Decimal = Field(gt=0, max_digits=12, decimal_places=2, examples=["100.00"])
    stock: int = Field(ge=0, le=2_147_483_647, strict=True)


class ItemCreate(Input):
    product_id: PositiveID
    quantity: Quantity


class OrderCreate(Input):
    user_id: PositiveID
    items: list[ItemCreate] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_products(self):
        ids = [item.product_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("Товар не должен повторяться в заказе")
        return self


class Output(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserOut(Output):
    id: int
    name: str
    email: str
    created_at: datetime


class ProductOut(Output):
    id: int
    name: str
    price: Decimal
    stock: int
    created_at: datetime


class ItemOut(Output):
    id: int
    product_id: int
    quantity: int
    unit_price: Decimal


class OrderOut(Output):
    id: int
    user_id: int
    status: Literal["created", "cancelled"]
    total_amount: Decimal
    created_at: datetime
    cancelled_at: datetime | None
    items: list[ItemOut]


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: list[dict] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ErrorDetail


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]


class DatabaseSnapshot(BaseModel):
    database: str
    tables: dict[str, list[dict]]
