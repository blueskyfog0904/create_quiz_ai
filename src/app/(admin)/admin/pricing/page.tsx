import { PricingPlansClient } from './pricing-plans-client'

export const metadata = {
    title: '요금제 관리 | 관리자',
}

export default function AdminPricingPage() {
    return (
        <div>
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900">요금제 관리</h1>
                <p className="text-gray-500 mt-1">사용자에게 판매할 크레딧 요금제를 설정합니다.</p>
            </div>

            <PricingPlansClient />
        </div>
    )
}
